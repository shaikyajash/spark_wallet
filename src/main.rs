use eyre::{Result, eyre};
use reqwest::Client;
use std::{
    io::{self, Write as IoWrite},
    time::Duration,
};

use garden_staging_swap_script::{
    Direction,
    TimingTracker,
    fetch_chains,
    garden_headers,
    get_owner_for_asset,
    load_config,
    resolve_asset_with_min,
    run_direction,
};

// ── Menu ───────────────────────────────────────────────────────────────────

fn show_menu(evm_wbtc: &str, btc_testnet: &str, spark_btc: &str) -> Result<String> {
    println!("\n╔══════════════════════════════════════════╗");
    println!("║    Garden Finance — Staging Swap CLI     ║");
    println!("╚══════════════════════════════════════════╝");
    println!();
    println!("  1)  {}  →  {}", evm_wbtc, spark_btc);
    println!("  2)  {}  →  {}", spark_btc, evm_wbtc);
    println!("  3)  {}  →  {}", btc_testnet, spark_btc);
    println!("  4)  {}  →  {}", spark_btc, btc_testnet);
    println!();

    loop {
        print!("Choice [1-4, q=quit]: ");
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        match input.trim() {
            "1" => return Ok("evm_to_spark".to_string()),
            "2" => return Ok("spark_to_evm".to_string()),
            "3" => return Ok("btc_to_spark".to_string()),
            "4" => return Ok("spark_to_btc".to_string()),
            "q" | "Q" => return Err(eyre!("aborted")),
            _ => println!("  Enter 1, 2, 3, 4, or q."),
        }
    }
}

// ── Entry point ────────────────────────────────────────────────────────────

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
    let (btc_testnet, btc_testnet_min) = resolve_asset_with_min(&chains, &config.btc_testnet_asset)?;
    let (spark_btc, spark_btc_min) = resolve_asset_with_min(&chains, &config.spark_btc_asset)?;

    println!("Assets resolved:");
    println!("  {} (min={})", evm_wbtc, evm_wbtc_min);
    println!("  {} (min={})", btc_testnet, btc_testnet_min);
    println!("  {} (min={})", spark_btc, spark_btc_min);

    let direction_str = match config.swap_direction.as_str() {
        "evm_to_spark" | "spark_to_evm" | "btc_to_spark" | "spark_to_btc" => {
            config.swap_direction.clone()
        }
        _ => show_menu(&evm_wbtc, &btc_testnet, &spark_btc)?,
    };

    let mut direction = match direction_str.as_str() {
        "evm_to_spark" => Direction {
            from_asset: &evm_wbtc,
            to_asset: &spark_btc,
            from_owner: get_owner_for_asset(&evm_wbtc, &config),
            to_owner: &config.spark_owner,
            min_amount: evm_wbtc_min,
        },
        "spark_to_evm" => Direction {
            from_asset: &spark_btc,
            to_asset: &evm_wbtc,
            from_owner: &config.spark_owner,
            to_owner: get_owner_for_asset(&evm_wbtc, &config),
            min_amount: spark_btc_min,
        },
        "btc_to_spark" => Direction {
            from_asset: &btc_testnet,
            to_asset: &spark_btc,
            from_owner: get_owner_for_asset(&btc_testnet, &config),
            to_owner: &config.spark_owner,
            min_amount: btc_testnet_min,
        },
        "spark_to_btc" => Direction {
            from_asset: &spark_btc,
            to_asset: &btc_testnet,
            from_owner: &config.spark_owner,
            to_owner: get_owner_for_asset(&btc_testnet, &config),
            min_amount: spark_btc_min,
        },
        other => return Err(eyre!("unknown direction '{}'", other)),
    };

    if let Some(amt) = config.from_amount_override {
        println!("FROM_AMOUNT override: {} (replaces chain min={})", amt, direction.min_amount);
        direction.min_amount = amt;
    }

    let mut tm = TimingTracker::new();
    run_direction(&client, &headers, &config, &direction, &mut tm).await?;
    Ok(())
}
