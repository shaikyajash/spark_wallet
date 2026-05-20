const { SparkWallet } = require('@buildonspark/spark-sdk');

(async () => {
    const mnemonic = 'shiver trim couple across robot bless culture upset high ivory output split';

    const { wallet } = await SparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        options: { network: 'REGTEST' },
    });

    const address = await wallet.getSparkAddress();
    console.log('Connected address:', address);

    console.log('Before:', await wallet.getWalletSettings());
    const after = await wallet.setPrivacyEnabled(false);
    console.log('After:', after);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
