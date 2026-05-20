// Two-phase batch: generate ALL orders first, then initiate them.
// Phase 1: quote + create order for all 100 (parallel within each lane).
// Phase 2: per-lane sequential approve+initiate (one nonce stream per wallet);
// lanes run in parallel.

use eyre::{Result, eyre};
use reqwest::Client;
use std::{sync::Arc, time::{Duration, Instant}};

use garden_staging_swap_script::{
    Direction, OrderCreateResult, fetch_chains, garden_headers, generate_order, generate_quote,
    load_config, resolve_asset_with_min, send_evm_tx,
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
    let order_concurrency: usize = std::env::var("ORDER_CONCURRENCY").ok().and_then(|s| s.parse().ok()).unwrap_or(10);

    let pk1 = config.evm_private_key.clone();
    let own1 = config.evm_owner.clone();
    let pk2 = std::env::var("EVM_PRIVATE_KEY_2")?;
    let own2 = std::env::var("EVM_OWNER_2")?;

    let half = total_swaps / 2;
    let lanes = vec![
        LaneConfig { idx: 1, private_key: pk1, owner: own1, swap_count: half },
        LaneConfig { idx: 2, private_key: pk2, owner: own2, swap_count: total_swaps - half },
    ];

    println!("== Two-phase batch: {} -> {} ==", evm_wbtc, spark_btc);
    println!("Total: {} | from_amount: {} sats | order concurrency/lane: {}",
             total_swaps, from_amount, order_concurrency);
    for l in &lanes {
        println!("Lane {}: owner={} count={}", l.idx, l.owner, l.swap_count);
    }

    let evm_wbtc = Arc::new(evm_wbtc);
    let spark_btc = Arc::new(spark_btc);
    let spark_owner = Arc::new(config.spark_owner.clone());
    let base_url = Arc::new(config.base_url.clone());
    let orderbook_url = Arc::new(config.orderbook_url.clone());
    let rpc_url = Arc::new(config.evm_rpc_url.clone());
    let app_id = Arc::new(config.app_id.clone());

    // ── Phase 1: Order creation ──────────────────────────────────────────────
    println!("\n=== Phase 1: creating {} orders ===", total_swaps);
    let phase1_start = Instant::now();

    let mut phase1_tasks = Vec::new();
    for lane in &lanes {
        let lane_idx = lane.idx;
        let owner = lane.owner.clone();
        let count = lane.swap_count;
        let evm_wbtc = evm_wbtc.clone();
        let spark_btc = spark_btc.clone();
        let spark_owner = spark_owner.clone();
        let base_url = base_url.clone();
        let orderbook_url = orderbook_url.clone();
        let app_id = app_id.clone();

        phase1_tasks.push(tokio::spawn(async move {
            let client = Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap();
            let headers = garden_headers(&app_id).unwrap();

            let direction = Direction {
                from_asset: &evm_wbtc,
                to_asset: &spark_btc,
                from_owner: &owner,
                to_owner: &spark_owner,
                min_amount: from_amount,
            };

            // Bounded concurrency per lane
            let sem = Arc::new(tokio::sync::Semaphore::new(order_concurrency));
            let mut inner = Vec::new();
            for i in 0..count {
                let permit_sem = sem.clone();
                let client = client.clone();
                let headers = headers.clone();
                let base_url = base_url.clone();
                let orderbook_url = orderbook_url.clone();
                let from_asset = evm_wbtc.clone();
                let to_asset = spark_btc.clone();
                let from_owner = owner.clone();
                let to_owner = spark_owner.clone();
                let tag = format!("[lane{} order {:03}/{:03}]", lane_idx, i + 1, count);
                inner.push(tokio::spawn(async move {
                    let _permit = permit_sem.acquire().await.unwrap();
                    let direction = Direction {
                        from_asset: &from_asset,
                        to_asset: &to_asset,
                        from_owner: &from_owner,
                        to_owner: &to_owner,
                        min_amount: from_amount,
                    };
                    let t0 = Instant::now();
                    let res = create_order(&client, &headers, &base_url, &orderbook_url, &direction).await;
                    match &res {
                        Ok(o) => {
                            let oid = o.order_id.clone().or(o.id.clone()).unwrap_or_default();
                            println!("{} OK order={} took={}ms", tag, oid, t0.elapsed().as_millis());
                        }
                        Err(e) => eprintln!("{} ERR {}", tag, e),
                    }
                    (i, res)
                }));
                let _ = &direction; // silence unused warn for outer
            }

            let mut results: Vec<Option<OrderCreateResult>> = (0..count).map(|_| None).collect();
            let mut errs: Vec<(usize, String)> = Vec::new();
            for h in inner {
                match h.await {
                    Ok((i, Ok(o))) => results[i] = Some(o),
                    Ok((i, Err(e))) => errs.push((i + 1, format!("{}", e))),
                    Err(e) => errs.push((0, format!("join: {}", e))),
                }
            }
            (lane_idx, results, errs)
        }));
    }

    let mut lane_orders: Vec<(usize, Vec<Option<OrderCreateResult>>, Vec<(usize, String)>)> = Vec::new();
    for t in phase1_tasks {
        lane_orders.push(t.await?);
    }
    let phase1_elapsed = phase1_start.elapsed();
    let total_created: usize = lane_orders.iter().map(|(_, r, _)| r.iter().filter(|x| x.is_some()).count()).sum();
    let total_failed: usize = lane_orders.iter().map(|(_, _, e)| e.len()).sum();
    println!("\nPhase 1 done in {:.1}s: created={} failed={}",
             phase1_elapsed.as_secs_f64(), total_created, total_failed);

    // ── Phase 2: Initiate (sequential per lane, parallel across lanes) ───────
    println!("\n=== Phase 2: initiating {} orders ===", total_created);
    let phase2_start = Instant::now();

    let mut phase2_tasks = Vec::new();
    for ((lane_idx, orders, _), lane) in lane_orders.into_iter().zip(lanes.iter()) {
        let pk = lane.private_key.clone();
        let rpc_url = rpc_url.clone();
        phase2_tasks.push(tokio::spawn(async move {
            let mut ok = 0usize;
            let mut errs: Vec<(usize, String)> = Vec::new();
            let total = orders.len();
            for (i, maybe_order) in orders.into_iter().enumerate() {
                let tag = format!("[lane{} init {:03}/{:03}]", lane_idx, i + 1, total);
                let Some(order) = maybe_order else {
                    errs.push((i + 1, "no order from phase 1".into()));
                    continue;
                };
                let order_id = order.order_id.clone().or(order.id.clone()).unwrap_or_default();
                let t0 = Instant::now();

                if let Some(approval) = &order.approval_transaction {
                    match send_evm_tx(&pk, &rpc_url, approval).await {
                        Ok(h) => println!("{} approve tx: {}", tag, h),
                        Err(e) => {
                            eprintln!("{} ERR approve: {}", tag, e);
                            errs.push((i + 1, format!("approve: {}", e)));
                            continue;
                        }
                    }
                }

                let Some(init_tx) = order.initiate_transaction.as_ref() else {
                    errs.push((i + 1, "no initiate_transaction".into()));
                    continue;
                };
                match send_evm_tx(&pk, &rpc_url, init_tx).await {
                    Ok(h) => {
                        ok += 1;
                        println!("{} OK order={} tx={} took={}ms",
                                 tag, order_id, h, t0.elapsed().as_millis());
                    }
                    Err(e) => {
                        eprintln!("{} ERR initiate: {}", tag, e);
                        errs.push((i + 1, format!("initiate: {}", e)));
                    }
                }
            }
            (lane_idx, ok, errs)
        }));
    }

    let mut total_ok = 0usize;
    let mut total_init_err = 0usize;
    for t in phase2_tasks {
        let (idx, ok, errs) = t.await?;
        total_ok += ok;
        total_init_err += errs.len();
        println!("\nLane {} init done: ok={} err={}", idx, ok, errs.len());
        for (i, e) in errs {
            println!("  swap #{}: {}", i, e);
        }
    }

    println!("\n=== Batch summary ===");
    println!("Orders created: {} (failed {})", total_created, total_failed);
    println!("Initiated ok:   {}", total_ok);
    println!("Initiate errs:  {}", total_init_err);
    println!("Phase 1 wall:   {:.1}s", phase1_elapsed.as_secs_f64());
    println!("Phase 2 wall:   {:.1}s", phase2_start.elapsed().as_secs_f64());
    Ok(())
}

async fn create_order(
    client: &Client,
    headers: &reqwest::header::HeaderMap,
    base_url: &str,
    orderbook_url: &str,
    direction: &Direction<'_>,
) -> Result<OrderCreateResult> {
    let quote = generate_quote(client, headers, base_url, direction, 0).await
        .map_err(|e| eyre!("quote: {}", e))?;
    let order = generate_order(client, headers, orderbook_url, direction, &quote).await
        .map_err(|e| eyre!("order: {}", e))?;
    Ok(order)
}
