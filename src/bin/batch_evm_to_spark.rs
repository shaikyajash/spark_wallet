// Batch runner: Arbi WBTC -> Spark BTC across multiple EVM wallets in parallel.
// Each wallet runs its swaps sequentially (one nonce stream); lanes run in parallel.
// Per swap: quote -> order -> approve (first only) -> initiate. Does NOT poll for
// destination redeem — watcher/solver complete the swap asynchronously.

use eyre::{Result, eyre};
use reqwest::Client;
use std::{sync::Arc, time::{Duration, Instant}};

use garden_staging_swap_script::{
    Direction, fetch_chains, garden_headers, generate_order, generate_quote, load_config,
    resolve_asset_with_min, send_evm_tx,
};

struct LaneConfig {
    idx: usize,
    private_key: String,
    owner: String,
    swap_count: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let config = load_config()?;

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()?;
    let headers = garden_headers(&config.app_id)?;
    let chains = fetch_chains(&client, &headers, &config.base_url).await?;

    let (evm_wbtc, evm_wbtc_min) = resolve_asset_with_min(&chains, &config.evm_wbtc_asset)?;
    let (spark_btc, _) = resolve_asset_with_min(&chains, &config.spark_btc_asset)?;

    let from_amount = config.from_amount_override.unwrap_or(evm_wbtc_min);
    let total_swaps: usize = std::env::var("TOTAL_SWAPS").ok().and_then(|s| s.parse().ok()).unwrap_or(100);

    // Parse two lanes from env. Wallet 1 from existing EVM_PRIVATE_KEY/EVM_OWNER,
    // wallet 2 from EVM_PRIVATE_KEY_2 / EVM_OWNER_2.
    let pk1 = config.evm_private_key.clone();
    let own1 = config.evm_owner.clone();
    let pk2 = std::env::var("EVM_PRIVATE_KEY_2")?;
    let own2 = std::env::var("EVM_OWNER_2")?;

    let half = total_swaps / 2;
    let lanes = vec![
        LaneConfig { idx: 1, private_key: pk1, owner: own1, swap_count: half },
        LaneConfig { idx: 2, private_key: pk2, owner: own2, swap_count: total_swaps - half },
    ];

    println!("== Batch: {} -> {} ==", evm_wbtc, spark_btc);
    println!("Total swaps: {}", total_swaps);
    println!("from_amount per swap: {} sats", from_amount);
    for l in &lanes {
        println!("Lane {}: owner={} swaps={}", l.idx, l.owner, l.swap_count);
    }

    let evm_wbtc = Arc::new(evm_wbtc);
    let spark_btc = Arc::new(spark_btc);
    let spark_owner = Arc::new(config.spark_owner.clone());
    let base_url = Arc::new(config.base_url.clone());
    let orderbook_url = Arc::new(config.orderbook_url.clone());
    let rpc_url = Arc::new(config.evm_rpc_url.clone());
    let app_id = Arc::new(config.app_id.clone());

    let started = Instant::now();
    let mut tasks = Vec::new();
    for lane in lanes {
        let evm_wbtc = evm_wbtc.clone();
        let spark_btc = spark_btc.clone();
        let spark_owner = spark_owner.clone();
        let base_url = base_url.clone();
        let orderbook_url = orderbook_url.clone();
        let rpc_url = rpc_url.clone();
        let app_id = app_id.clone();

        tasks.push(tokio::spawn(async move {
            let client = Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap();
            let headers = garden_headers(&app_id).unwrap();

            let direction = Direction {
                from_asset: &evm_wbtc,
                to_asset: &spark_btc,
                from_owner: &lane.owner,
                to_owner: &spark_owner,
                min_amount: from_amount,
            };

            let mut ok = 0usize;
            let mut errs: Vec<(usize, String)> = Vec::new();

            for i in 0..lane.swap_count {
                let tag = format!("[lane{} swap {:02}/{:02}]", lane.idx, i + 1, lane.swap_count);
                let t0 = Instant::now();
                match run_one(&client, &headers, &base_url, &orderbook_url, &rpc_url,
                              &lane.private_key, &direction, &tag).await
                {
                    Ok(order_id) => {
                        ok += 1;
                        println!("{} OK order={} took={}ms",
                                 tag, order_id, t0.elapsed().as_millis());
                    }
                    Err(e) => {
                        let msg = format!("{}", e);
                        eprintln!("{} ERR {}", tag, msg);
                        errs.push((i + 1, msg));
                    }
                }
            }

            (lane.idx, ok, errs)
        }));
    }

    let mut total_ok = 0usize;
    let mut total_err = 0usize;
    for t in tasks {
        let (idx, ok, errs) = t.await?;
        total_ok += ok;
        total_err += errs.len();
        println!("\nLane {} done: ok={} err={}", idx, ok, errs.len());
        for (i, e) in errs {
            println!("  swap #{}: {}", i, e);
        }
    }

    println!("\n=== Batch summary ===");
    println!("Total ok:  {}", total_ok);
    println!("Total err: {}", total_err);
    println!("Wall time: {:.1}s", started.elapsed().as_secs_f64());
    Ok(())
}

async fn run_one(
    client: &Client,
    headers: &reqwest::header::HeaderMap,
    base_url: &str,
    orderbook_url: &str,
    rpc_url: &str,
    private_key: &str,
    direction: &Direction<'_>,
    tag: &str,
) -> Result<String> {
    let quote = generate_quote(client, headers, base_url, direction, 0).await
        .map_err(|e| eyre!("quote: {}", e))?;

    let order = generate_order(client, headers, orderbook_url, direction, &quote).await
        .map_err(|e| eyre!("order: {}", e))?;

    let order_id = order.order_id.clone()
        .or(order.id.clone())
        .ok_or_else(|| eyre!("order_id missing"))?;

    if let Some(approval) = &order.approval_transaction {
        println!("{} sending approve...", tag);
        let h = send_evm_tx(private_key, rpc_url, approval).await
            .map_err(|e| eyre!("approve: {}", e))?;
        println!("{} approve tx: {}", tag, h);
    }

    let init_tx = order.initiate_transaction.as_ref()
        .ok_or_else(|| eyre!("no initiate_transaction"))?;
    let h = send_evm_tx(private_key, rpc_url, init_tx).await
        .map_err(|e| eyre!("initiate: {}", e))?;
    println!("{} initiate tx: {} order: {}", tag, h, order_id);
    Ok(order_id)
}
