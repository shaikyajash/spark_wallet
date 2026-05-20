// Send a tiny random Spark payment (1–10 sats) to every expired Spark→EVM
// order's HTLC deposit address, forcing the watcher to mark them terminal
// via the refund path.

require('dotenv').config();
const { SparkWallet } = require('@buildonspark/spark-sdk');

const ORDERBOOK_BASE_URL = process.env.ORDERBOOK_BASE_URL;
const APP_ID = process.env.GARDEN_APP_ID;
const MNEMONIC = process.env.SPARK_MNEMONIC || 'wild volume fox chair baby bind end match admit member share twin';

const headers = {
    'Content-Type': 'application/json',
    'garden-app-id': APP_ID,
    'app-id': APP_ID,
};

async function fetchAllExpired() {
    const all = [];
    const perPage = 100;
    let page = 1;
    while (true) {
        const url = `${ORDERBOOK_BASE_URL}/v2/orders?status=expired&from_chain=spark_regtest&per_page=${perPage}&page=${page}`;
        const r = await fetch(url, { headers });
        if (!r.ok) throw new Error(`list http ${r.status}: ${await r.text()}`);
        const j = await r.json();
        const res = j.result || {};
        const data = res.data || [];
        all.push(...data);
        const totalPages = res.total_pages || 1;
        if (page >= totalPages || data.length === 0) break;
        page++;
    }
    return all;
}

(async () => {
    console.log(`== Refunding expired Spark→EVM orders ==`);
    console.log(`Connecting Spark wallet…`);
    const { wallet } = await SparkWallet.initialize({
        mnemonicOrSeed: MNEMONIC.trim(),
        options: { network: 'REGTEST' },
    });
    const addr = await wallet.getSparkAddress();
    console.log(`wallet: ${addr}`);

    console.log(`\nFetching expired orders…`);
    const orders = await fetchAllExpired();
    console.log(`Fetched ${orders.length} expired Spark-source orders.`);

    const targets = [];
    let skipped = 0;
    for (const o of orders) {
        const s = o.source_swap || {};
        if (s.refund_tx_hash || s.initiate_tx_hash) { skipped++; continue; }
        if (!s.initiator) { skipped++; continue; }
        if (s.initiator === addr) { skipped++; continue; }
        targets.push({ orderId: o.order_id || o.id, to: s.initiator });
    }
    console.log(`Targets: ${targets.length} (skipped: ${skipped})`);

    let ok = 0, err = 0;
    const tStart = Date.now();
    for (let i = 0; i < targets.length; i++) {
        const { orderId, to } = targets[i];
        const amt = Math.floor(Math.random() * 10) + 1;
        const tag = `[${String(i + 1).padStart(3, '0')}/${targets.length}]`;
        const t0 = Date.now();
        try {
            const tx = await wallet.transfer({ receiverSparkAddress: to.trim(), amountSats: amt });
            const txId = String(tx?.id ?? tx);
            console.log(`${tag} OK order=${orderId} amt=${amt} tx=${txId} took=${Date.now() - t0}ms`);
            ok++;
        } catch (e) {
            console.error(`${tag} ERR order=${orderId} amt=${amt}: ${e.message || e}`);
            err++;
        }
    }

    console.log(`\n=== Summary ===`);
    console.log(`fetched:  ${orders.length}`);
    console.log(`skipped:  ${skipped}`);
    console.log(`ok:       ${ok}`);
    console.log(`err:      ${err}`);
    console.log(`wall:     ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
