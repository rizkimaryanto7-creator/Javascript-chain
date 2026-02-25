// 🔧 Core Setup
const express = require('express');
const path = require('path');
const { Worker } = require('worker_threads');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// 📦 Modular Components
const walletCore = require('./wallet');
const minerCore = require('./miner');
const chainCore = require('./chain');
const blockCore = require('./block');
const networkCore = require('./network');
const cliInterface = require('./cli');

// 🔐 Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 🧠 View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 🧱 Data Fallback (sinkron ke file chain.json & transactions.json)
let chain;
try {
  chain = chainCore.getChain?.() || JSON.parse(fs.readFileSync('./chain.json'));
} catch (err) {
  chain = [
    {
      index: 0,
      hash: '0000000000000000',
      previousHash: 'null',
      timestamp: Date.now(),
      transactions: [{ from: 'SYSTEM', to: '0xabc123', amount: 25000000 }]
    }
  ];
}

let transactions;
try {
  transactions = chainCore.getTransactions?.() || JSON.parse(fs.readFileSync('./transactions.json'));
} catch (err) {
  transactions = [];
}

const wallets = walletCore.getAll?.() || [
  { name: 'Main Wallet', address: '0xabc123', balance: 120 },
  { name: 'Mining Wallet', address: '0xdef456', balance: 45 }
];

const peers = networkCore.getPeers?.() || ['node1.jschain.net', 'node2.jschain.net'];
const minerStats = minerCore.getStatus?.() || { active: true, hashRate: 0.42, address: '0xminer001' };

const chainVersion = chainCore.version || 'v1.0.3';
const latestHash = chain.length ? chain[chain.length - 1].hash : 'N/A';


// 🧭 View Routes
app.get('/', (req, res) => res.render('home', { chainVersion, latestHash }));
app.get('/explorer', (req, res) => res.render('explorer', { chain }));
app.get('/wallets', (req, res) => res.render('wallets', { wallets }));
app.get('/wallet_detail', (req, res) => res.render('wallet_detail', { wallet: wallets[0] }));
app.get('/wallet_history', (req, res) => res.render('wallet_history', { wallets }));
app.get('/address_detail', (req, res) => res.render('address_detail', { address: wallets[0].address, balance: wallets[0].balance }));
app.get('/miner', (req, res) => res.render('miner_stats', { minerStats }));
app.get('/transactions', (req, res) => res.render('transactions', { transactions }));
app.get('/tx_detail', (req, res) => res.render('tx_detail', { tx: transactions[0] }));
app.get('/block_detail', (req, res) => res.render('block_detail', { block: chain[0] }));
app.get('/block_details', (req, res) => res.render('block_details', { blocks: blockCore.getAll?.() || chain }));
app.get('/block', (req, res) => res.render('block', { block: blockCore.getLatest?.() || chain[chain.length - 1] }));
app.get('/send', (req, res) => res.render('send'));
app.get('/balance', (req, res) => res.render('balance'));
app.get('/peers', (req, res) => res.render('peers', { peers }));
app.get('/login', (req, res) => res.render('login'));
app.get('/index', (req, res) => res.render('index', { chain }));


// 🔧 API Routes

// Buat wallet baru
app.get('/api/wallet/new', (req, res) => {
  const newWallet = walletCore.generate?.();
  res.json(newWallet || { error: 'Wallet module not available' });
});

// Kirim transaksi baru
app.post('/api/transactions/send', (req, res) => {
  const { from, to, amount } = req.body;
  if (!from || !to || !amount) {
    return res.status(400).json({ error: 'Invalid transaction data' });
  }
  const tx = { from, to, amount, hash: `tx${Date.now()}` };
  transactions.push(tx);
  fs.writeFileSync('./transactions.json', JSON.stringify(transactions, null, 2));
  res.json({ success: true, tx });
});

// Mulai miner
app.get('/api/miner/start', (req, res) => {
  const blockData = JSON.stringify(blockCore.getLatest?.() || chain[chain.length - 1]);
  const difficulty = 5; // samakan dengan node.js
  const minerAddress = wallets[0].address;

  const worker = new Worker('./minerWorker.js', {
    workerData: { core: 'js-chain-core', blockData, difficulty, minerAddress }
  });

  worker.on('message', msg => {
    if (msg.found) {
      console.log(`✅ Block mined! Hash: ${msg.hash}, Nonce: ${msg.nonce}`);
      // Update chain.json setiap block baru
      chain.push({
        index: chain.length,
        hash: msg.hash,
        previousHash: latestHash,
        timestamp: Date.now(),
        transactions: transactions
      });
      fs.writeFileSync('./chain.json', JSON.stringify(chain, null, 2));
      transactions = []; // clear pool setelah mining
      fs.writeFileSync('./transactions.json', JSON.stringify(transactions, null, 2));
    } else {
      console.log(`⛏️ Hashrate: ${msg.hashrate} H/s | Best: ${msg.bestHash}`);
    }
  });

  worker.on('error', err => console.error('❌ Worker error:', err));

  res.json({ started: true });
});

// Status chain
app.get('/api/chain/status', (req, res) => {
  const status = chainCore.getStatus?.() || { height: chain.length, latestHash };
  res.json(status);
});

// Peers
app.get('/api/network/peers', (req, res) => res.json(peers));

// Latest block
app.get('/api/blocks/latest', (req, res) => res.json(blockCore.getLatest?.() || chain[chain.length - 1]));

// CLI help
app.get('/api/cli/help', (req, res) => {
  const helpText = cliInterface.getHelp?.() || 'CLI commands not available.';
  res.send(`<pre>${helpText}</pre>`);
});


// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`✅ JavaScript-chain server running on port ${PORT}`);
});
