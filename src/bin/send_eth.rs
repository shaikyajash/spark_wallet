use ethers::prelude::*;
use ethers::utils::parse_ether;
use eyre::Result;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let rpc = std::env::var("EVM_RPC_URL")
        .unwrap_or_else(|_| "https://sepolia-rollup.arbitrum.io/rpc".to_string());
    let pk = std::env::var("EVM_PRIVATE_KEY")?;
    let to: Address = std::env::var("TO")?.parse()?;
    let amount_eth = std::env::var("AMOUNT_ETH").unwrap_or_else(|_| "0.002".to_string());

    let provider = Provider::<Http>::try_from(rpc)?;
    let chain_id = provider.get_chainid().await?.as_u64();
    let wallet: LocalWallet = pk.trim_start_matches("0x").parse::<LocalWallet>()?.with_chain_id(chain_id);
    let from = wallet.address();
    let client = Arc::new(SignerMiddleware::new(provider, wallet));

    let value = parse_ether(&amount_eth)?;
    println!("From: {:?}\nTo:   {:?}\nAmount: {} ETH\nChain: {}", from, to, amount_eth, chain_id);

    let tx = TransactionRequest::new().to(to).value(value).from(from);
    let pending = client.send_transaction(tx, None).await?;
    println!("Tx hash: {:?}", pending.tx_hash());
    let receipt = pending.await?.ok_or_else(|| eyre::eyre!("no receipt"))?;
    println!("Mined in block {:?}, status={:?}", receipt.block_number, receipt.status);
    Ok(())
}
