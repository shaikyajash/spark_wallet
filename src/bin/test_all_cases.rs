use eyre::{Result, eyre};
use reqwest::{Client, header::HeaderMap};
use std::time::Duration;

use garden_staging_swap_script::{
    AppConfig,
    Direction,
    QuoteData,
    SwapOutcome,
    TimingTracker,
    execute_with_quote,
    fetch_chains,
    garden_headers,
    generate_quote,
    load_config,
    resolve_asset_with_min,
    run_direction,
};

struct TestCase<'a> {
    name: &'a str,
    direction: Direction<'a>,
}

struct TestConfig {
    cycles: u32,
    spark_net_limit_sats: i128,
    max_rebalance_rounds: u32,
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let config = load_config()?;
    let test_config = load_test_config();

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()?;
    let headers = garden_headers(&config.app_id)?;

    let chains = fetch_chains(&client, &headers, &config.base_url).await?;

    let (evm_wbtc, evm_wbtc_min) = resolve_asset_with_min(&chains, &config.evm_wbtc_asset)?;
    let (spark_btc, spark_btc_min) = resolve_asset_with_min(&chains, &config.spark_btc_asset)?;

    println!("Assets resolved:");
    println!("  {} (min={})", evm_wbtc, evm_wbtc_min);
    println!("  {} (min={})", spark_btc, spark_btc_min);

    let evm_to_spark = Direction {
        from_asset: &evm_wbtc,
        to_asset: &spark_btc,
        from_owner: &config.evm_owner,
        to_owner: &config.spark_owner,
        min_amount: evm_wbtc_min,
    };

    let spark_to_evm = Direction {
        from_asset: &spark_btc,
        to_asset: &evm_wbtc,
        from_owner: &config.spark_owner,
        to_owner: &config.evm_owner,
        min_amount: spark_btc_min,
    };

    let cases = vec![
        TestCase { name: "evm_to_spark", direction: evm_to_spark.clone() },
        TestCase { name: "spark_to_evm", direction: spark_to_evm.clone() },
    ];

    let mut net_spent_sats: i128 = 0;

    for cycle in 1..=test_config.cycles {
        println!("\n====================");
        println!("Test cycle {cycle}/{}", test_config.cycles);
        println!("Net Spark BTC spent: {} sats (limit {})", net_spent_sats, test_config.spark_net_limit_sats);
        println!("====================");

        for case in &cases {
            println!("\n--- Case: {} ---", case.name);
            let quote = prepare_quote_with_rebalance(
                &client,
                &headers,
                &config,
                &case.direction,
                &evm_to_spark,
                &spark_btc,
                &mut net_spent_sats,
                test_config.spark_net_limit_sats,
                test_config.max_rebalance_rounds,
            ).await?;

            let mut tm = TimingTracker::new();
            let outcome = execute_with_quote(
                &client,
                &headers,
                &config,
                &case.direction,
                &quote,
                &mut tm,
            ).await?;

            net_spent_sats += spark_net_delta(&outcome, &spark_btc);
            println!(
                "Net Spark BTC spent: {} sats (limit {})",
                net_spent_sats,
                test_config.spark_net_limit_sats
            );

            if net_spent_sats > test_config.spark_net_limit_sats {
                return Err(eyre!(
                    "spark net spend exceeded limit: {} > {}",
                    net_spent_sats,
                    test_config.spark_net_limit_sats
                ));
            }
        }
    }

    println!(
        "\nFinished all cases. Net Spark BTC spent: {} sats (limit {})",
        net_spent_sats,
        test_config.spark_net_limit_sats
    );

    Ok(())
}

async fn prepare_quote_with_rebalance(
    client: &Client,
    headers: &HeaderMap,
    config: &AppConfig,
    direction: &Direction<'_>,
    evm_to_spark: &Direction<'_>,
    spark_asset: &str,
    net_spent_sats: &mut i128,
    spark_net_limit: i128,
    max_rebalance_rounds: u32,
) -> Result<QuoteData> {
    let mut rounds = 0;
    let mut quote = generate_quote(client, headers, &config.base_url, direction, config.gas_bump_units).await?;

    if direction.from_asset != spark_asset {
        return Ok(quote);
    }

    loop {
        let projected = *net_spent_sats + quote.from_amount as i128;
        if projected <= spark_net_limit {
            return Ok(quote);
        }

        if rounds >= max_rebalance_rounds {
            return Err(eyre!(
                "rebalance limit reached: need net <= {}, current {}, next swap {}",
                spark_net_limit,
                net_spent_sats,
                quote.from_amount
            ));
        }

        rounds += 1;
        println!(
            "\nRebalancing (round {}/{}): net {} sats, upcoming spend {} sats",
            rounds,
            max_rebalance_rounds,
            net_spent_sats,
            quote.from_amount
        );

        let mut tm = TimingTracker::new();
        let outcome = run_direction(client, headers, config, evm_to_spark, &mut tm).await?;

        *net_spent_sats += spark_net_delta(&outcome, spark_asset);
        println!(
            "Net Spark BTC spent after rebalance: {} sats (limit {})",
            net_spent_sats,
            spark_net_limit
        );

        quote = generate_quote(client, headers, &config.base_url, direction, config.gas_bump_units).await?;
    }
}

fn spark_net_delta(outcome: &SwapOutcome, spark_asset: &str) -> i128 {
    if outcome.from_asset == spark_asset {
        outcome.from_amount as i128
    } else if outcome.to_asset == spark_asset {
        -(outcome.to_amount as i128)
    } else {
        0
    }
}

fn load_test_config() -> TestConfig {
    TestConfig {
        cycles: env_or("TEST_CYCLES", "1").parse().unwrap_or(1),
        spark_net_limit_sats: env_or("SPARK_NET_LIMIT_SATS", "15").parse().unwrap_or(15),
        max_rebalance_rounds: env_or("MAX_REBALANCE_ROUNDS", "5").parse().unwrap_or(5),
    }
}

fn env_or(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.to_string())
}
