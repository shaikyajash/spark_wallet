use ethers::{
    middleware::SignerMiddleware,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{transaction::eip1559::Eip1559TransactionRequest, Address, Bytes, U256},
};
use eyre::{Result, eyre};
use reqwest::{
    Client,
    header::{HeaderMap, HeaderValue},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::time::sleep;

pub const DEFAULT_BASE_URL: &str = "http://gsg8cwk4k8oscg4sgcgg8ww8.garden-staging.dealpulley.com";
pub const DEFAULT_ORDERBOOK_URL: &str = "http://w4skog4oscw8sk00c8g8wg8s.garden-staging.dealpulley.com";
pub const DEFAULT_EVM_WBTC_ASSET: &str = "arbitrum_sepolia:wbtc";
pub const DEFAULT_BTC_TESTNET_ASSET: &str = "bitcoin_testnet:btc";
pub const DEFAULT_SPARK_BTC_ASSET: &str = "spark:btc";
pub const DEFAULT_EVM_RPC_URL: &str = "https://sepolia-rollup.arbitrum.io/rpc";

// 50_000_000 wei = 0.05 Gwei — works on Arbitrum Sepolia without "max fee < base fee" errors
pub const MAX_FEE_PER_GAS: u64 = 0x2FAF080;
pub const MAX_PRIORITY_FEE_PER_GAS: u64 = 0x989680;

// ── Config ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub base_url: String,
    pub orderbook_url: String,
    pub evm_rpc_url: String,
    pub app_id: String,
    pub evm_owner: String,
    pub spark_owner: String,
    pub btc_testnet_owner: String,
    pub evm_private_key: String,
    pub gas_bump_units: u128,
    pub from_amount_override: Option<u128>,
    pub poll_secs: u64,
    pub timeout_mins: u64,
    pub swap_direction: String,
    pub evm_wbtc_asset: String,
    pub btc_testnet_asset: String,
    pub spark_btc_asset: String,
}

#[derive(Debug, Clone)]
pub struct Direction<'a> {
    pub from_asset: &'a str,
    pub to_asset: &'a str,
    pub from_owner: &'a str,
    pub to_owner: &'a str,
    pub min_amount: u128,
}

// ── API types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct QuoteData {
    pub from_amount: u128,
    pub to_amount: u128,
    pub solver_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct OrderRequest {
    source: OrderAsset,
    destination: OrderAsset,
    solver_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct OrderAsset {
    asset: String,
    owner: String,
    amount: String,
}

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    status: String,
    result: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ChainsResult {
    List(Vec<ChainInfo>),
    Wrapped { chains: Vec<ChainInfo> },
}

#[derive(Debug, Deserialize)]
pub struct ChainInfo {
    #[serde(default)]
    assets: Vec<ChainAsset>,
    #[serde(default)]
    tokens: Vec<ChainAsset>,
    #[serde(default)]
    supported_assets: Vec<ChainAsset>,
}

#[derive(Debug, Deserialize)]
pub struct ChainAsset {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    asset: Option<String>,
    #[serde(default)]
    min_amount: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QuoteItem {
    #[serde(default)]
    solver_id: Option<String>,
    #[serde(default)]
    destination: Option<QuoteAmountNode>,
}

#[derive(Debug, Deserialize)]
struct QuoteAmountNode {
    #[serde(default)]
    amount: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct EvmTxData {
    to: String,
    data: String,
    gas_limit: String,
    value: String,
    #[serde(default)]
    chain_id: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct OrderCreateResult {
    #[serde(default)]
    pub order_id: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub approval_transaction: Option<EvmTxData>,
    #[serde(default)]
    pub initiate_transaction: Option<EvmTxData>,
    // Spark-source orders return a payment address + amount instead of EVM calldata
    #[serde(rename = "to", default)]
    pub spark_to: Option<String>,
    #[serde(default)]
    pub amount: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OrderStatusResult {
    #[serde(default)]
    source_swap: Option<SwapStatus>,
    #[serde(default)]
    destination_swap: Option<SwapStatus>,
}

#[derive(Debug, Deserialize)]
struct SwapStatus {
    #[serde(default)]
    initiate_tx_hash: Option<String>,
    #[serde(default)]
    redeem_tx_hash: Option<String>,
    #[serde(default)]
    secret: Option<String>,
}

// ── Timing tracker ─────────────────────────────────────────────────────────

pub struct TimingTracker {
    start: Instant,
    prev_ms: u128,
    events: Vec<(String, u128, u128, String)>, // (label, elapsed_ms, delta_ms, detail)
}

impl TimingTracker {
    pub fn new() -> Self {
        Self { start: Instant::now(), prev_ms: 0, events: Vec::new() }
    }

    pub fn stamp(&mut self, label: &str, detail: impl Into<String>) -> String {
        let elapsed = self.start.elapsed().as_millis();
        let delta = elapsed.saturating_sub(self.prev_ms);
        self.prev_ms = elapsed;
        self.events.push((label.to_string(), elapsed, delta, detail.into()));
        format!("[{} | +{}ms | d+{}ms]", utc_now(), elapsed, delta)
    }

    pub fn print_summary(&self) {
        let sep = "-".repeat(80);
        println!("\n{sep}");
        println!("  TIMING SUMMARY");
        println!("{sep}");
        println!("{:<34} {:>10} {:>10}  {}", "Milestone", "Elapsed", "Delta", "Detail");
        println!("{sep}");
        for (label, elapsed_ms, delta_ms, detail) in &self.events {
            let d = if detail.len() > 30 { &detail[detail.len()-30..] } else { detail.as_str() };
            println!("{:<34} {:>8}ms {:>8}ms  {}", label, elapsed_ms, delta_ms, d);
        }
        println!("{sep}");
        if let Some((_, total, _, _)) = self.events.last() {
            println!("  Total: {}ms  ({:.2}s)", total, *total as f64 / 1000.0);
        }
        println!("{sep}");
    }
}

fn utc_now() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let ms = now.subsec_millis();
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{:02}:{:02}:{:02}.{:03}Z", h, m, s, ms)
}

pub fn source_is_evm(from_asset: &str) -> bool {
    let chain = from_asset.split(':').next().unwrap_or("");
    matches!(chain, "arbitrum_sepolia" | "ethereum_sepolia" | "citrea_testnet")
}

pub fn get_owner_for_asset<'a>(asset: &str, config: &'a AppConfig) -> &'a str {
    let chain = asset.split(':').next().unwrap_or("");
    match chain {
        "spark" => &config.spark_owner,
        "bitcoin_testnet" | "bitcoin_mainnet" | "bitcoin_regtest" => &config.btc_testnet_owner,
        _ => &config.evm_owner,
    }
}

// ── Trait impls ────────────────────────────────────────────────────────────

impl ChainsResult {
    fn chains(&self) -> &[ChainInfo] {
        match self {
            ChainsResult::List(v) => v.as_slice(),
            ChainsResult::Wrapped { chains } => chains.as_slice(),
        }
    }
}

impl ChainAsset {
    fn asset_id(&self) -> Option<&str> {
        self.id.as_deref().or(self.asset.as_deref())
    }
}

impl<T> ApiResponse<T> {
    fn require_result(self, ctx: &str) -> Result<T> {
        match (self.status.as_str(), self.result) {
            ("Ok", Some(v)) => Ok(v),
            _ => Err(eyre!(
                "{} failed: status={}, error={}",
                ctx,
                self.status,
                self.error.unwrap_or_else(|| "unknown".to_string())
            )),
        }
    }
}

// ── Swap execution ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SwapOutcome {
    pub from_asset: String,
    pub to_asset: String,
    pub from_amount: u128,
    pub to_amount: u128,
}

pub async fn run_direction(
    client: &Client,
    headers: &HeaderMap,
    config: &AppConfig,
    direction: &Direction<'_>,
    tm: &mut TimingTracker,
) -> Result<SwapOutcome> {
    let quote = generate_quote(client, headers, &config.base_url, direction, config.gas_bump_units).await?;
    execute_with_quote(client, headers, config, direction, &quote, tm).await
}

pub async fn execute_with_quote(
    client: &Client,
    headers: &HeaderMap,
    config: &AppConfig,
    direction: &Direction<'_>,
    quote: &QuoteData,
    tm: &mut TimingTracker,
) -> Result<SwapOutcome> {
    println!("\n== Swap: {} -> {} ==", direction.from_asset, direction.to_asset);
    println!("{} Quote received", tm.stamp("Quote received", &quote.solver_id));
    println!("  from_amount : {}", quote.from_amount);
    println!("  to_amount   : {}", quote.to_amount);
    println!("  solver_id   : {}", quote.solver_id);

    let order = generate_order(client, headers, &config.orderbook_url, direction, quote).await?;

    let order_id = order.order_id.as_deref()
        .or(order.id.as_deref())
        .ok_or_else(|| eyre!("order_id missing from response"))?
        .to_string();

    println!("{} Order created", tm.stamp("Order created", &order_id));
    println!("  id: {}", order_id);

    if source_is_evm(direction.from_asset) {
        // ERC-20 approval first if required (WBTC needs to approve the HTLC contract)
        if let Some(approval_tx) = order.approval_transaction {
            println!("\n{} Sending ERC-20 approval...", tm.stamp("Approval sending", ""));
            let hash = send_evm_tx(&config.evm_private_key, &config.evm_rpc_url, &approval_tx).await?;
            println!("{} Approval confirmed", tm.stamp("Approval confirmed", &hash));
            println!("  tx: {}", hash);
        }

        let initiate_tx = order.initiate_transaction
            .ok_or_else(|| eyre!("no initiate_transaction in order response"))?;

        println!("\n{} Sending HTLC initiate...", tm.stamp("HTLC initiate sending", ""));
        let hash = send_evm_tx(&config.evm_private_key, &config.evm_rpc_url, &initiate_tx).await?;
        println!("{} HTLC initiate confirmed", tm.stamp("HTLC initiate confirmed", &hash));
        println!("  tx: {}", hash);

    } else if let Some(initiate_tx) = order.initiate_transaction.as_ref() {
        // Non-EVM source with EVM-routed initiate (orderbook wraps the payment as calldata)
        println!("\n{} Sending HTLC initiate (non-EVM source routed via EVM)...",
            tm.stamp("HTLC initiate sending", ""));
        let hash = send_evm_tx(&config.evm_private_key, &config.evm_rpc_url, initiate_tx).await?;
        println!("{} HTLC initiate confirmed", tm.stamp("HTLC initiate confirmed", &hash));
        println!("  tx: {}", hash);

    } else {
        // Non-EVM source without calldata — user must send manually to the solver's HTLC address
        print_manual_initiation(&order, &order_id, &quote, direction, tm)?;
    }

    println!("\nPolling (every {}s, timeout {}min)...", config.poll_secs, config.timeout_mins);
    let deadline = Instant::now() + Duration::from_secs(config.timeout_mins * 60);

    let mut seen_src_initiate = false;
    let mut seen_dst_initiate = false;
    let mut seen_dst_redeem = false;
    let mut seen_src_redeem = false;

    loop {
        let url = format!("{}/v2/orders/{}", config.orderbook_url, order_id);
        let resp: ApiResponse<OrderStatusResult> = get_json(client, headers, &url).await?;
        let status = resp.require_result("order status")?;

        let src = status.source_swap.as_ref();
        let dst = status.destination_swap.as_ref();

        let src_init      = src.and_then(|s| s.initiate_tx_hash.as_deref()).unwrap_or("");
        let src_redeem_tx = src.and_then(|s| s.redeem_tx_hash.as_deref()).unwrap_or("");
        let dst_init      = dst.and_then(|s| s.initiate_tx_hash.as_deref()).unwrap_or("");
        let dst_redeem_tx = dst.and_then(|s| s.redeem_tx_hash.as_deref()).unwrap_or("");
        let secret = dst.and_then(|s| s.secret.as_deref())
            .or_else(|| src.and_then(|s| s.secret.as_deref()))
            .unwrap_or("");

        if !src_init.is_empty() && !seen_src_initiate {
            seen_src_initiate = true;
            println!("{} Source swap visible on orderbook", tm.stamp("Source on orderbook", src_init));
            println!("  tx: {}", src_init);
        }
        if !dst_init.is_empty() && !seen_dst_initiate {
            seen_dst_initiate = true;
            println!("{} Solver initiated on destination", tm.stamp("Solver dest initiated", dst_init));
            println!("  tx: {}", dst_init);
        }
        if !dst_redeem_tx.is_empty() && !seen_dst_redeem {
            seen_dst_redeem = true;
            println!("{} Destination redeemed — {} delivered",
                tm.stamp("Destination redeemed", dst_redeem_tx), direction.to_asset);
            println!("  tx: {}", dst_redeem_tx);
            if !secret.is_empty() {
                println!("  secret: {}", secret);
            }
        }
        if !src_redeem_tx.is_empty() && !seen_src_redeem {
            seen_src_redeem = true;
            println!("{} Source redeemed by solver (fully settled)",
                tm.stamp("Source redeemed", src_redeem_tx));
            println!("  tx: {}", src_redeem_tx);
        }

        // Primary completion: destination delivered = user has their funds.
        // source_swap.redeem_tx_hash (solver claiming source) may not appear promptly.
        if seen_dst_redeem {
            println!("{} Swap complete.", tm.stamp("Swap complete", ""));
            break;
        }

        if Instant::now() > deadline {
            println!("{} Timed out after {} minutes.", tm.stamp("Timeout", ""), config.timeout_mins);
            break;
        }

        sleep(Duration::from_secs(config.poll_secs)).await;
    }

    tm.print_summary();

    Ok(SwapOutcome {
        from_asset: direction.from_asset.to_string(),
        to_asset: direction.to_asset.to_string(),
        from_amount: quote.from_amount,
        to_amount: quote.to_amount,
    })
}

fn print_manual_initiation(
    order: &OrderCreateResult,
    order_id: &str,
    quote: &QuoteData,
    direction: &Direction<'_>,
    tm: &mut TimingTracker,
) -> Result<()> {
    let to_addr = order.spark_to.as_deref().filter(|s| !s.is_empty())
        .ok_or_else(|| eyre!("manual initiation missing 'to' address"))?;
    let amount_str = {
        let amt = order.amount.as_deref().unwrap_or(&quote.from_amount.to_string()).to_string();
        format!("{amt} satoshis ({})", direction.from_asset)
    };

    let title = "ACTION REQUIRED — send this payment manually";
    let rows: &[(&str, &str)] = &[
        ("To",     to_addr),
        ("Amount", &amount_str),
        ("Order",  order_id),
    ];

    let key_w   = rows.iter().map(|(k, _)| k.len()).max().unwrap_or(0);
    let val_w   = rows.iter().map(|(_, v)| v.len()).max().unwrap_or(0);
    let inner_w = (key_w + 2 + val_w).max(title.len());
    let bar     = "─".repeat(inner_w + 4);

    println!("{} Awaiting manual initiation", tm.stamp("Awaiting manual initiation", ""));
    println!();
    println!("  ┌{bar}┐");
    println!("  │  {title:<inner_w$}  │");
    println!("  ├{bar}┤");
    for (key, val) in rows {
        println!("  │  {key:<key_w$}  {val:<val_w$}  │");
    }
    println!("  └{bar}┘");
    println!();
    println!("  Polling until the solver delivers {} to you...", direction.to_asset);
    Ok(())
}

// ── Quote / Order helpers ──────────────────────────────────────────────────

pub async fn generate_quote(
    client: &Client,
    headers: &HeaderMap,
    base_url: &str,
    direction: &Direction<'_>,
    gas_bump_units: u128,
) -> Result<QuoteData> {
    let from_asset = direction.from_asset;
    let to_asset = direction.to_asset;
    let from_amount = direction.min_amount + gas_bump_units;
    let url = format!(
        "{base_url}/v2/quote?from={from_asset}&to={to_asset}&from_amount={from_amount}&indicative=false"
    );
    let h = quote_server_headers(headers);
    let raw: serde_json::Value = get_json(client, &h, &url).await?;
    println!("\nRaw quote:\n{}", serde_json::to_string_pretty(&raw)?);

    let items: Vec<QuoteItem> = serde_json::from_value(raw["result"].clone())
        .map_err(|e| eyre!("quote parse error: {}", e))?;
    let first = items.into_iter().next().ok_or_else(|| eyre!("empty quote result"))?;

    let solver_id = first.solver_id.unwrap_or_default();
    let to_amount = first
        .destination
        .as_ref()
        .and_then(|d| d.amount.as_deref())
        .and_then(|s| s.parse::<u128>().ok())
        .unwrap_or(from_amount.saturating_mul(995) / 1000);

    Ok(QuoteData { from_amount, to_amount, solver_id })
}

pub async fn generate_order(
    client: &Client,
    headers: &HeaderMap,
    base_url: &str,
    direction: &Direction<'_>,
    quote: &QuoteData,
) -> Result<OrderCreateResult> {
    let body = OrderRequest {
        source: OrderAsset {
            asset: direction.from_asset.to_string(),
            owner: direction.from_owner.to_string(),
            amount: quote.from_amount.to_string(),
        },
        destination: OrderAsset {
            asset: direction.to_asset.to_string(),
            owner: direction.to_owner.to_string(),
            amount: quote.to_amount.to_string(),
        },
        solver_id: quote.solver_id.clone(),
    };

    let url = format!("{base_url}/v2/orders");
    println!("\nPOST {url}");
    println!("Body:\n{}", serde_json::to_string_pretty(&body)?);

    let raw: serde_json::Value = post_json(client, headers, &url, &body).await?;
    println!("Order response:\n{}", serde_json::to_string_pretty(&raw)?);

    let resp: ApiResponse<OrderCreateResult> =
        serde_json::from_value(raw).map_err(|e| eyre!("order parse error: {}", e))?;
    resp.require_result("create order")
}

// ── EVM transaction signing ────────────────────────────────────────────────

pub async fn send_evm_tx(private_key: &str, rpc_url: &str, tx_data: &EvmTxData) -> Result<String> {
    let provider = Provider::<Http>::try_from(rpc_url)
        .map_err(|e| eyre!("bad RPC URL: {}", e))?;

    let chain_id = match &tx_data.chain_id {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(serde_json::Value::String(s)) => parse_hex_or_dec_u64(s).unwrap_or(0),
        _ => 0,
    };
    let chain_id = if chain_id == 0 {
        provider.get_chainid().await?.as_u64()
    } else {
        chain_id
    };

    let pk = private_key.strip_prefix("0x").unwrap_or(private_key);
    let wallet = pk
        .parse::<LocalWallet>()
        .map_err(|e| eyre!("invalid private key: {}", e))?
        .with_chain_id(chain_id);

    let client = Arc::new(SignerMiddleware::new(provider, wallet));

    let to: Address = tx_data
        .to
        .parse()
        .map_err(|e| eyre!("invalid 'to' address {}: {}", tx_data.to, e))?;
    let data = Bytes::from(
        hex::decode(tx_data.data.trim_start_matches("0x"))
            .map_err(|e| eyre!("invalid tx data hex: {}", e))?,
    );
    let gas_limit = U256::from(parse_hex_or_dec_u64(&tx_data.gas_limit)?);
    let value = parse_hex_or_dec_u256(&tx_data.value)?;

    println!(
        "  chain={} to={} gas={} value={}",
        chain_id, tx_data.to, gas_limit, value
    );

    let tx = Eip1559TransactionRequest::new()
        .to(to)
        .data(data)
        .gas(gas_limit)
        .value(value)
        .max_fee_per_gas(U256::from(MAX_FEE_PER_GAS))
        .max_priority_fee_per_gas(U256::from(MAX_PRIORITY_FEE_PER_GAS));

    let pending = client
        .send_transaction(tx, None)
        .await
        .map_err(|e| eyre!("send_transaction: {}", e))?;

    println!("  [{}] tx submitted: {:?}", utc_now(), pending.tx_hash());

    let receipt = pending
        .confirmations(1)
        .await
        .map_err(|e| eyre!("waiting for receipt: {}", e))?
        .ok_or_else(|| eyre!("tx dropped from mempool"))?;

    println!("  [{}] tx confirmed (block {})", utc_now(), receipt.block_number.unwrap_or_default());

    Ok(format!("{:?}", receipt.transaction_hash))
}

// ── Parsing helpers ────────────────────────────────────────────────────────

fn parse_hex_or_dec_u64(s: &str) -> Result<u64> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16).map_err(|e| eyre!("invalid hex u64 '{}': {}", s, e))
    } else {
        s.parse::<u64>().map_err(|e| eyre!("invalid u64 '{}': {}", s, e))
    }
}

fn parse_hex_or_dec_u256(s: &str) -> Result<U256> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        U256::from_str_radix(hex, 16).map_err(|e| eyre!("invalid hex U256 '{}': {}", s, e))
    } else {
        s.parse::<u128>()
            .map(U256::from)
            .map_err(|e| eyre!("invalid U256 '{}': {}", s, e))
    }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

pub fn garden_headers(app_id: &str) -> Result<HeaderMap> {
    let mut h = HeaderMap::new();
    h.insert("accept", HeaderValue::from_static("application/json"));
    h.insert("content-type", HeaderValue::from_static("application/json"));
    if !app_id.is_empty() {
        h.insert("garden-app-id", HeaderValue::from_str(app_id)?);
    }
    Ok(h)
}

// Headers without garden-app-id — required for the quote server which rejects the header.
fn quote_server_headers(headers: &HeaderMap) -> HeaderMap {
    let mut h = headers.clone();
    h.remove("garden-app-id");
    h
}

async fn get_json<R: DeserializeOwned>(client: &Client, headers: &HeaderMap, url: &str) -> Result<R> {
    let r = client.get(url).headers(headers.clone()).send().await?;
    let status = r.status();
    let body = r.text().await?;
    if !status.is_success() {
        return Err(eyre!("GET {} [{}]: {}", url, status, body));
    }
    serde_json::from_str(&body).map_err(|e| eyre!("GET {} bad JSON: {} ({})", url, body, e))
}

async fn post_json<T: Serialize, R: DeserializeOwned>(
    client: &Client,
    headers: &HeaderMap,
    url: &str,
    body: &T,
) -> Result<R> {
    let r = client.post(url).headers(headers.clone()).json(body).send().await?;
    let status = r.status();
    let text = r.text().await?;
    if !status.is_success() {
        return Err(eyre!("POST {} [{}]: {}", url, status, text));
    }
    serde_json::from_str(&text).map_err(|e| eyre!("POST {} bad JSON: {} ({})", url, text, e))
}

pub async fn fetch_chains(
    client: &Client,
    headers: &HeaderMap,
    base_url: &str,
) -> Result<ChainsResult> {
    let h = quote_server_headers(headers);
    let chains_resp: ApiResponse<ChainsResult> =
        get_json(client, &h, &format!("{}/v2/chains", base_url)).await?;
    chains_resp.require_result("chains request")
}

// ── Asset resolution ───────────────────────────────────────────────────────

fn get_min_amount(chains: &ChainsResult, asset: &str) -> Result<u128> {
    let asset_lower = asset.to_lowercase();
    for chain in chains.chains() {
        for a in chain.assets.iter().chain(&chain.tokens).chain(&chain.supported_assets) {
            if let (Some(id), Some(min)) = (a.asset_id(), a.min_amount.as_deref())
                && id.eq_ignore_ascii_case(&asset_lower)
            {
                return min.parse::<u128>()
                    .map_err(|e| eyre!("invalid min_amount for {}: {}", asset, e));
            }
        }
    }
    Err(eyre!("min_amount not found for asset: {}", asset))
}

pub fn resolve_asset_with_min(chains: &ChainsResult, requested: &str) -> Result<(String, u128)> {
    if let Ok(min) = get_min_amount(chains, requested) {
        return Ok((requested.to_string(), min));
    }

    let lower = requested.to_lowercase();
    let mut parts = lower.splitn(2, ':');
    let network = parts.next().unwrap_or_default();
    let token = parts.next().unwrap_or_default();

    let mut candidates: Vec<(String, u128)> = Vec::new();
    for chain in chains.chains() {
        for a in chain.assets.iter().chain(&chain.tokens).chain(&chain.supported_assets) {
            let Some(id) = a.asset_id() else { continue };
            let Some(min_str) = a.min_amount.as_deref() else { continue };
            let id_lower = id.to_lowercase();
            if !token.is_empty() && !id_lower.ends_with(&format!(":{token}")) {
                continue;
            }
            let net_suffix = network.split('_').last().unwrap_or("");
            if !net_suffix.is_empty() && !id_lower.contains(net_suffix) {
                continue;
            }
            if let Ok(min) = min_str.parse::<u128>() {
                candidates.push((id.to_string(), min));
            }
        }
    }

    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => Err(eyre!("asset not found: {}", requested)),
        _ => Err(eyre!(
            "ambiguous asset '{}' — set EVM_WBTC_ASSET/BTC_TESTNET_ASSET/SPARK_BTC_ASSET explicitly. Candidates: {:?}",
            requested,
            candidates.iter().map(|(id, _)| id).collect::<Vec<_>>()
        )),
    }
}

// ── Env helpers ────────────────────────────────────────────────────────────

pub fn load_config() -> Result<AppConfig> {
    Ok(AppConfig {
        base_url: env_or("GARDEN_BASE_URL", DEFAULT_BASE_URL),
        orderbook_url: env_or("ORDERBOOK_BASE_URL", DEFAULT_ORDERBOOK_URL),
        evm_rpc_url: env_or("EVM_RPC_URL", DEFAULT_EVM_RPC_URL),
        app_id: env_or("GARDEN_APP_ID", ""),
        evm_owner: req_env("EVM_OWNER")?,
        spark_owner: req_env("SPARK_OWNER")?,
        btc_testnet_owner: env_or("BTC_TESTNET_OWNER", ""),
        evm_private_key: req_env("EVM_PRIVATE_KEY")?,
        gas_bump_units: env_or("GAS_BUMP_UNITS", "0").parse().unwrap_or(0),
        from_amount_override: std::env::var("FROM_AMOUNT").ok().and_then(|s| s.parse::<u128>().ok()),
        poll_secs: env_or("POLL_SECS", "10").parse().unwrap_or(10),
        timeout_mins: env_or("TIMEOUT_MINS", "5").parse().unwrap_or(5),
        swap_direction: env_or("SWAP_DIRECTION", "menu"),
        evm_wbtc_asset: env_or("EVM_WBTC_ASSET", DEFAULT_EVM_WBTC_ASSET),
        btc_testnet_asset: env_or("BTC_TESTNET_ASSET", DEFAULT_BTC_TESTNET_ASSET),
        spark_btc_asset: env_or("SPARK_BTC_ASSET", DEFAULT_SPARK_BTC_ASSET),
    })
}

fn req_env(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| eyre!("missing env var: {}", key))
}

fn env_or(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.to_string())
}
