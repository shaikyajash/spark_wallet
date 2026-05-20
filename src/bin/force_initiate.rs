/// Manually send ERC-20 approval + HTLC initiate for an existing order.
/// Usage: cargo run --bin force_initiate
use ethers::{
    abi::{Function, FunctionExt, Param, ParamType, StateMutability, Token, self},
    middleware::SignerMiddleware,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{transaction::eip1559::Eip1559TransactionRequest, Address, Bytes, U256},
};
use eyre::{Result, eyre};
use std::sync::Arc;

const RPC_URL: &str = "https://sepolia-rollup.arbitrum.io/rpc";
const WBTC_ADDRESS: &str = "0x1c287717c886794ac9f5DF3987195431Ceb3456E";
const HTLC_ADDRESS: &str = "0xb5AE9785349186069C48794a763DB39EC756B1cF";

const REDEEMER: &str    = "0x404c64698911F0cd167AfD43FF86095DF89120E0";
const TIMELOCK: u64     = 432000;
const AMOUNT: u64       = 10;
const SECRET_HASH: &str = "e91faeb07b759e7b3756f0498c30c6eca38f0abff7c6dc5e57d7882c57c97168";
const DEST_RECIPIENT: &str = "spark1pgss8dzjt8gcddt5v4lnz9wtr0karthsltg3mkhx09r4a568j43kc7p94gcmk4";

// approve(address,uint256) — well-known selector
const APPROVE_SELECTOR: [u8; 4] = [0x09, 0x5e, 0xa7, 0xb3];

const MAX_FEE_PER_GAS: u64 = 0x2FAF080;
const MAX_PRIORITY_FEE_PER_GAS: u64 = 0x989680;

fn initiate_selector() -> [u8; 4] {
    Function {
        name: "initiate".to_string(),
        inputs: vec![
            Param { name: "redeemer".to_string(),        kind: ParamType::Address,      internal_type: None },
            Param { name: "timelock".to_string(),        kind: ParamType::Uint(256),    internal_type: None },
            Param { name: "amount".to_string(),          kind: ParamType::Uint(256),    internal_type: None },
            Param { name: "secretHash".to_string(),      kind: ParamType::FixedBytes(32), internal_type: None },
            Param { name: "destinationData".to_string(), kind: ParamType::Bytes,        internal_type: None },
        ],
        outputs: vec![],
        constant: None,
        state_mutability: StateMutability::NonPayable,
    }.selector()
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let private_key = std::env::var("EVM_PRIVATE_KEY")
        .map_err(|_| eyre!("EVM_PRIVATE_KEY not set"))?;

    let provider = Provider::<Http>::try_from(RPC_URL)?;
    let chain_id = provider.get_chainid().await?.as_u64();
    println!("Chain ID: {chain_id}");

    let pk = private_key.strip_prefix("0x").unwrap_or(&private_key);
    let wallet = pk.parse::<LocalWallet>()?.with_chain_id(chain_id);
    let client = Arc::new(SignerMiddleware::new(provider, wallet));

    let htlc: Address   = HTLC_ADDRESS.parse()?;
    let wbtc: Address   = WBTC_ADDRESS.parse()?;
    let redeemer: Address = REDEEMER.parse()?;
    let amount   = U256::from(AMOUNT);
    let timelock = U256::from(TIMELOCK);
    let secret_hash_vec = hex::decode(SECRET_HASH)?;
    let dest_data = DEST_RECIPIENT.as_bytes().to_vec();

    let sel = initiate_selector();
    println!("initiate selector: 0x{}", hex::encode(sel));

    // ── Step 1: ERC-20 approve ────────────────────────────────────────────────
    println!("\n[1/2] Approving WBTC ({AMOUNT} units) for HTLC...");
    let approve_calldata = {
        let mut d = APPROVE_SELECTOR.to_vec();
        d.extend(abi::encode(&[Token::Address(htlc), Token::Uint(amount)]));
        d
    };

    let receipt = send_tx(&client, wbtc, approve_calldata, 100_000).await?;
    println!("  confirmed (block {}) tx: {:?}", receipt.block_number.unwrap_or_default(), receipt.transaction_hash);

    // ── Step 2: HTLC initiate ─────────────────────────────────────────────────
    println!("\n[2/2] HTLC initiate...");
    println!("  redeemer    : {REDEEMER}");
    println!("  timelock    : {TIMELOCK}s");
    println!("  amount      : {AMOUNT}");
    println!("  secret_hash : {SECRET_HASH}");
    println!("  dest        : {DEST_RECIPIENT}");

    let mut secret_hash_bytes = [0u8; 32];
    secret_hash_bytes.copy_from_slice(&secret_hash_vec);

    let initiate_calldata = {
        let mut d = sel.to_vec();
        d.extend(abi::encode(&[
            Token::Address(redeemer),
            Token::Uint(timelock),
            Token::Uint(amount),
            Token::FixedBytes(secret_hash_bytes.to_vec()),
            Token::Bytes(dest_data),
        ]));
        d
    };

    let receipt = send_tx(&client, htlc, initiate_calldata, 300_000).await?;
    println!("  confirmed (block {}) tx: {:?}", receipt.block_number.unwrap_or_default(), receipt.transaction_hash);
    println!("\nDone.");
    Ok(())
}

async fn send_tx(
    client: &Arc<SignerMiddleware<Provider<Http>, LocalWallet>>,
    to: Address,
    data: Vec<u8>,
    gas: u64,
) -> Result<ethers::types::TransactionReceipt> {
    let tx = Eip1559TransactionRequest::new()
        .to(to)
        .data(Bytes::from(data))
        .gas(U256::from(gas))
        .max_fee_per_gas(U256::from(MAX_FEE_PER_GAS))
        .max_priority_fee_per_gas(U256::from(MAX_PRIORITY_FEE_PER_GAS));

    let pending = client.send_transaction(tx, None).await
        .map_err(|e| eyre!("send failed: {e}"))?;
    println!("  tx submitted: {:?}", pending.tx_hash());
    pending.confirmations(1).await?
        .ok_or_else(|| eyre!("tx dropped from mempool"))
}
