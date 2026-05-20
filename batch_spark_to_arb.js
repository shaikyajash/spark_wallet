// Batch: 100 swaps from spark_regtest:btc -> arbitrum_sepolia:wbtc.
// Phase 1: create all 100 orders against the orderbook (concurrent).
// Phase 2: send the corresponding Spark transfers (sequential — one wallet).

require('dotenv').config();
const { SparkWallet } = require('@buildonspark/spark-sdk');

const GARDEN_BASE_URL    = process.env.GARDEN_BASE_URL;
const ORDERBOOK_BASE_URL = process.env.ORDERBOOK_BASE_URL;
const APP_ID             = process.env.GARDEN_APP_ID;

const MNEMONIC = process.env.SPARK_MNEMONIC || 'wild volume fox chair baby bind end match admit member share twin';
const SPARK_OWNER = process.env.SPARK_FROM_OWNER || 'sparkrt1pgssyjnc4p35n5ew2ah0h9w5z9me20x60l585xeujgunx2qfs0cznkw2r5pwv7';
const EVM_DEST_OWNER = (process.env.EVM_DEST_OWNER || process.env.EVM_OWNER || '0x7801aE8881A59F231fA31D7a5b56cb20766fd2eB');
const FROM_ASSET = 'spark_regtest:btc';
const TO_ASSET = 'arbitrum_sepolia:wbtc';
const FROM_AMOUNT = parseInt(process.env.FROM_AMOUNT || '5', 10);
const TOTAL = parseInt(process.env.TOTAL_SWAPS || '400', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const ORDER_CONCURRENCY = parseInt(process.env.ORDER_CONCURRENCY || '10', 10);
const TRANSFER_CONCURRENCY = parseInt(process.env.TRANSFER_CONCURRENCY || '1', 10);

const headers = {
    'Content-Type': 'application/json',
    'garden-app-id': APP_ID,
    'app-id': APP_ID,
};

async function getQuote() {
    const url = `${GARDEN_BASE_URL}/v2/quote?from=${FROM_ASSET}&to=${TO_ASSET}&from_amount=${FROM_AMOUNT}&indicative=false`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`quote http ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const item = (j.result || [])[0];
    if (!item) throw new Error(`quote empty: ${JSON.stringify(j)}`);
    const toAmount = parseInt(item?.destination?.amount || String(Math.floor(FROM_AMOUNT * 0.995)), 10);
    return { toAmount, solver_id: item.solver_id || '' };
}

async function createOrder(quote) {
    const url = `${ORDERBOOK_BASE_URL}/v2/orders`;
    const body = {
        source: { asset: FROM_ASSET, owner: SPARK_OWNER, amount: String(FROM_AMOUNT) },
        destination: { asset: TO_ASSET, owner: EVM_DEST_OWNER, amount: String(quote.toAmount) },
        solver_id: quote.solver_id,
    };
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`order http ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const order = j.result || j;
    const orderId = order.order_id || order.id || '';
    const to = order.to || order.spark_to || '';
    const amount = order.amount || String(FROM_AMOUNT);
    if (!to) throw new Error(`order missing 'to': ${JSON.stringify(order)}`);
    return { orderId, to, amount: parseInt(amount, 10) };
}

async function pLimitMap(items, concurrency, fn) {
    const results = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
            const idx = i++;
            if (idx >= items.length) return;
            try { results[idx] = { ok: true, value: await fn(items[idx], idx) }; }
            catch (e) { results[idx] = { ok: false, error: e.message || String(e) }; }
        }
    });
    await Promise.all(workers);
    return results;
}

(async () => {
    const numBatches = Math.ceil(TOTAL / BATCH_SIZE);
    console.log(`== Spark→Arb: ${TOTAL} swaps in ${numBatches} batches of ${BATCH_SIZE} × ${FROM_AMOUNT} sats ==`);
    console.log(`from owner: ${SPARK_OWNER}`);
    console.log(`dest owner: ${EVM_DEST_OWNER}`);

    console.log(`\nConnecting Spark wallet…`);
    const { wallet } = await SparkWallet.initialize({
        mnemonicOrSeed: MNEMONIC.trim(),
        options: { network: 'REGTEST' },
    });
    const addr = await wallet.getSparkAddress();
    console.log(`wallet address: ${addr}`);
    if (addr !== SPARK_OWNER) {
        console.warn(`!! wallet address differs from SPARK_OWNER (${SPARK_OWNER}). Continuing with derived: ${addr}`);
    }

    const tStart = Date.now();
    let totalCreated = 0, totalFailedP1 = 0, totalOk = 0, totalErr = 0;

    for (let b = 0; b < numBatches; b++) {
        const remaining = TOTAL - b * BATCH_SIZE;
        const size = Math.min(BATCH_SIZE, remaining);
        const offset = b * BATCH_SIZE;
        console.log(`\n############ Batch ${b + 1}/${numBatches}  (${size} swaps) ############`);

        // Phase 1
        console.log(`\n=== Phase 1: creating ${size} orders (concurrency=${ORDER_CONCURRENCY}) ===`);
        const t1 = Date.now();
        const tasks = Array.from({ length: size }, (_, i) => i);
        const orderResults = await pLimitMap(tasks, ORDER_CONCURRENCY, async (i) => {
            const tag = `[b${b + 1} order ${String(i + 1).padStart(2, '0')}/${size}]`;
            const t0 = Date.now();
            const q = await getQuote();
            const o = await createOrder(q);
            console.log(`${tag} OK order=${o.orderId} to=${o.to.slice(0, 24)}… amt=${o.amount} took=${Date.now() - t0}ms`);
            return o;
        });
        const created = orderResults.filter(r => r.ok).length;
        const failedP1 = orderResults.length - created;
        totalCreated += created; totalFailedP1 += failedP1;
        console.log(`Phase 1 batch ${b + 1} done in ${((Date.now() - t1) / 1000).toFixed(1)}s: created=${created} failed=${failedP1}`);

        // Phase 2
        console.log(`\n=== Phase 2: sending ${created} Spark transfers (concurrency=${TRANSFER_CONCURRENCY}) ===`);
        const t2 = Date.now();
        let ok = 0, errs = 0;
        const indices = Array.from({ length: orderResults.length }, (_, i) => i);
        await pLimitMap(indices, TRANSFER_CONCURRENCY, async (i) => {
            const r = orderResults[i];
            const tag = `[b${b + 1} xfer  ${String(i + 1).padStart(2, '0')}/${size}]`;
            if (!r.ok) { console.log(`${tag} SKIP (no order: ${r.error})`); errs++; return; }
            const { orderId, to, amount } = r.value;
            const t0 = Date.now();
            try {
                const tx = await wallet.transfer({ receiverSparkAddress: to.trim(), amountSats: amount });
                const txId = String(tx?.id ?? tx);
                console.log(`${tag} OK order=${orderId} tx=${txId} took=${Date.now() - t0}ms`);
                ok++;
            } catch (e) {
                console.error(`${tag} ERR order=${orderId}: ${e.message || e}`);
                errs++;
            }
        });
        totalOk += ok; totalErr += errs;
        console.log(`Phase 2 batch ${b + 1} done in ${((Date.now() - t2) / 1000).toFixed(1)}s: ok=${ok} err=${errs}`);
        console.log(`Batch ${b + 1} total wall: ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    }

    console.log(`\n=== Grand Summary ===`);
    console.log(`Total target:     ${TOTAL}`);
    console.log(`Orders created:   ${totalCreated} (failed ${totalFailedP1})`);
    console.log(`Transfers ok:     ${totalOk}`);
    console.log(`Transfers err:    ${totalErr}`);
    console.log(`Total wall time:  ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
