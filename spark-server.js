const http = require('http');
const fs = require('fs');
const path = require('path');
const { SparkWallet, SparkReadonlyClient, getNetworkFromSparkAddress, isValidSparkAddress } = require('@buildonspark/spark-sdk');

let wallet = null;
const readonlyClients = new Map();

function getReadonlyClient(network) {
    if (!readonlyClients.has(network)) {
        readonlyClients.set(network, SparkReadonlyClient.createPublic({ network }));
    }
    return readonlyClients.get(network);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url = new URL(req.url, 'http://localhost:3000');

    // Serve HTML
    if (req.method === 'GET' && url.pathname === '/') {
        const html = fs.readFileSync(path.join(__dirname, 'spark-wallet.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    // POST /api/connect  { mnemonic }
    if (req.method === 'POST' && url.pathname === '/api/connect') {
        const { mnemonic, network = 'REGTEST' } = JSON.parse(await readBody(req));
        try {
            const result = await SparkWallet.initialize({
                mnemonicOrSeed: mnemonic.trim(),
                options: { network }
            });
            wallet = result.wallet;
            const address = await wallet.getSparkAddress();
            json(res, 200, { address });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    // GET /api/balance
    if (req.method === 'GET' && url.pathname === '/api/balance') {
        if (!wallet) return json(res, 400, { error: 'Not connected' });
        try {
            const address = await wallet.getSparkAddress();
            const network = getNetworkFromSparkAddress(address);
            if (!network) return json(res, 400, { error: 'Unknown network for connected wallet' });
            const client = getReadonlyClient(network);
            const balance = await client.getAvailableBalance(address);
            json(res, 200, { sats: String(balance), network });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    // GET /api/status
    if (req.method === 'GET' && url.pathname === '/api/status') {
        if (!wallet) return json(res, 200, { connected: false });
        try {
            const address = await wallet.getSparkAddress();
            json(res, 200, { connected: true, address });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    // GET /api/address-balance?address=spark1...
    if (req.method === 'GET' && url.pathname === '/api/address-balance') {
        const address = (url.searchParams.get('address') || '').trim();
        if (!address) return json(res, 400, { error: 'Missing spark address' });
        if (!isValidSparkAddress(address)) return json(res, 400, { error: 'Invalid spark address' });
        const network = getNetworkFromSparkAddress(address);
        if (!network) return json(res, 400, { error: 'Unknown network for address' });
        try {
            const client = getReadonlyClient(network);
            const balance = await client.getAvailableBalance(address);
            json(res, 200, { sats: String(balance), network });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    // POST /api/send  { to, sats }
    if (req.method === 'POST' && url.pathname === '/api/send') {
        if (!wallet) return json(res, 400, { error: 'Not connected' });
        const { to, sats } = JSON.parse(await readBody(req));
        try {
            const tx = await wallet.transfer({
                receiverSparkAddress: to.trim(),
                amountSats: parseInt(sats),
            });
            json(res, 200, { txId: String(tx?.id ?? tx) });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    // GET /api/transfers?limit=20&offset=0
    if (req.method === 'GET' && url.pathname === '/api/transfers') {
        if (!wallet) return json(res, 400, { error: 'Not connected' });
        try {
            const limit  = parseInt(url.searchParams.get('limit')  || '20');
            const offset = parseInt(url.searchParams.get('offset') || '0');
            const result = await wallet.getTransfers(limit, offset);
            const transfers = result.transfers.map(t => ({
                id:        t.id,
                direction: t.transferDirection,
                type:      t.type,
                status:    t.status,
                sats:      t.totalValue,
                createdAt: t.createdTime ? t.createdTime.toISOString() : null,
            }));
            json(res, 200, { transfers, offset: result.offset });
        } catch (e) {
            json(res, 500, { error: e.message });
        }
        return;
    }

    res.writeHead(404); res.end('Not found');
});

server.listen(3000, () => {
    console.log('Spark Wallet UI → http://localhost:3000');
});
