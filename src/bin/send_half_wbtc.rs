// Sends half of WBTC balance on Arbitrum Sepolia to a recipient,
// then sends a small amount of ETH for gas.
//
// Env:
//   EVM_PRIVATE_KEY   — sender private key
//   TO                — recipient (defaults to the address provided on CLI)
//   EVM_RPC_URL       — defaults to Arbitrum Sepolia public RPC
//   GAS_ETH           — ETH to send for gas (default 0.002)
//   WBTC_ADDRESS      — defaults to Arb Sepolia WBTC

use ethers::prelude::*;
use ethers::utils::{format_units, parse_ether};
use eyre::Result;
use std::sync::Arc;

abigen!(
    Erc20,
    r#"[
        function balanceOf(address) view returns (uint256)
        function decimals() view returns (uint8)
        function transfer(address,uint256) returns (bool)
    ]"#
);

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let rpc = std::env::var("EVM_RPC_URL")
        .unwrap_or_else(|_| "https://sepolia-rollup.arbitrum.io/rpc".to_string());
    let pk = std::env::var("EVM_PRIVATE_KEY")?;
    let to: Address = std::env::var("TO")?.parse()?;
    let wbtc_addr: Address = std::env::var("WBTC_ADDRESS")
        .unwrap_or_else(|_| "0x1c287717c886794ac9f5DF3987195431Ceb3456E".to_string())
        .parse()?;
    let gas_eth = std::env::var("GAS_ETH").unwrap_or_else(|_| "0.002".to_string());

    let provider = Provider::<Http>::try_from(rpc)?;
    let chain_id = provider.get_chainid().await?.as_u64();
    let wallet: LocalWallet = pk
        .trim_start_matches("0x")
        .parse::<LocalWallet>()?
        .with_chain_id(chain_id);
    let from = wallet.address();
    let client = Arc::new(SignerMiddleware::new(provider, wallet));

    println!("From:    {:?}", from);
    println!("To:      {:?}", to);
    println!("Chain:   {}", chain_id);
    println!("WBTC:    {:?}", wbtc_addr);

    let wbtc = Erc20::new(wbtc_addr, client.clone());
    let decimals = wbtc.decimals().call().await?;
    let bal: U256 = wbtc.balance_of(from).call().await?;
    let half = bal / 2;

    println!(
        "WBTC balance: {} ({} units, {} decimals)",
        format_units(bal, decimals as u32)?,
        bal,
        decimals
    );
    println!(
        "Sending half: {} ({} units)",
        format_units(half, decimals as u32)?,
        half
    );

    if half.is_zero() {
        eyre::bail!("WBTC balance is zero — nothing to send");
    }

    let call = wbtc.transfer(to, half);
    let pending = call.send().await?;
    println!("WBTC transfer tx: {:?}", pending.tx_hash());
    let receipt = pending.await?.ok_or_else(|| eyre::eyre!("no receipt"))?;
    println!(
        "  mined block={:?} status={:?}",
        receipt.block_number, receipt.status
    );

    let value = parse_ether(&gas_eth)?;
    println!("\nSending {} ETH for gas...", gas_eth);
    let tx = TransactionRequest::new().to(to).value(value).from(from);
    let pending = client.send_transaction(tx, None).await?;
    println!("ETH transfer tx: {:?}", pending.tx_hash());
    let receipt = pending.await?.ok_or_else(|| eyre::eyre!("no receipt"))?;
    println!(
        "  mined block={:?} status={:?}",
        receipt.block_number, receipt.status
    );

    Ok(())
}
