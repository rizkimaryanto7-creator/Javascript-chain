// 🔧 Core Setup
const express = require('express');
const path = require('path');
const { Worker } = require('worker_threads');
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

// 🧱 Data Fallback
const chain = chainCore.getChain?.() || [
  {
    index: 0,
    hash: '0000000000000000',
    previousHash: 'null',
    timestamp: Date.now(),
    transactions: [{ from: 'SYSTEM', to: '0xabc123', amount: 25000000 }]
  }
];

const wallets = walletCore.getAll?.() || [
  { name: 'Main Wallet', address: '0xabc123', balance: 120 },
  { name: 'Mining Wallet', address: '0xdef456', balance: 45 }
];

const peers = networkCore.getPeers?.() || ['node1.jschain.net', 'node2.jschain.net'];
const transactions = chainCore.getTransactions?.() || [
  { from: '0xabc', to: '0xdef', amount: 50, hash: 'tx001' },
  { from: '0xdef', to: '0xghi', amount: 20, hash: 'tx002' }
];

const minerStats = minerCore.getStatus?.() || {
  active: true,
  hashRate: 0.42,
  address: '0xminer001'
};

const chainVersion = chainCore.version || 'v1.0.3';
const latestHash = chain.length ? chain[chain.length - 1].hash : 'N/A';


// 🧭 View Routes

app.get('/', (req, res) => {
  res.render('home', { chainVersion, latestHash });
});

app.get('/explorer', (req, res) => {
  res.render('explorer', { chain });
});

app.get('/wallets', (req, res) => {
  res.render('wallets', { wallets });
});

app.get('/wallet_detail', (req, res) => {
  res.render('wallet_detail', { wallet: wallets[0] });
});

app.get('/wallet_history', (req, res) => {
  res.render('wallet_history', { wallets });
});

app.get('/address_detail', (req, res) => {
  res.render('address_detail', {
    address: wallets[0].address,
    balance: wallets[0].balance
  });
});

app.get('/miner', (req, res) => {
  res.render('miner_stats', { minerStats });
});

app.get('/transactions', (req, res) => {
  res.render('transactions', { transactions });
});

app.get('/tx_detail', (req, res) => {
  res.render('tx_detail', { tx: transactions[0] });
});

app.get('/block_detail', (req, res) => {
  res.render('block_detail', { block: chain[0] });
});

app.get('/block_details', (req, res) => {
  const blocks = blockCore.getAll?.() || chain;
  res.render('block_details', { blocks });
});

app.get('/block', (req, res) => {
  const block = blockCore.getLatest?.() || chain[chain.length - 1];
  res.render('block', { block });
});

app.get('/send', (req, res) => {
  res.render('send');
});

app.get('/balance', (req, res) => {
  res.render('balance');
});

app.get('/peers', (req, res) => {
  res.render('peers', { peers });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/index', (req, res) => {
  res.render('index', { chain });
});


// 🔧 API Routes

app.get('/api/wallet/new', (req, res) => {
  const newWallet = walletCore.generate?.();
  res.json(newWallet || { error: 'Wallet module not available' });
});

app.get('/api/miner/start', (req, res) => {
  const blockData = JSON.stringify(blockCore.getLatest?.() || chain[chain.length - 1]);
  const difficulty = 3;
  const minerAddress = wallets[0].address;

  const worker = new Worker('./minerWorker.js', {
    workerData: {
      core: 'js-chain-core',
      blockData,
      difficulty,
      minerAddress
    }
  });

  worker.on('message', msg => {
    if (msg.found) {
      console.log(`✅ Block mined! Hash: ${msg.hash}, Nonce: ${msg.nonce}`);
    } else {
      console.log(`⛏️ Hashrate: ${msg.hashrate} H/s | Best: ${msg.bestHash}`);
    }
  });

  worker.on('error', err => {
    console.error('❌ Worker error:', err);
  });

  res.json({ started: true });
});

app.get('/api/chain/status', (req, res) => {
  const status = chainCore.getStatus?.() || {
    height: chain.length,
    latestHash
  };
  res.json(status);
});

app.get('/api/network/peers', (req, res) => {
  res.json(peers);
});

app.get('/api/blocks/latest', (req, res) => {
  const latest = blockCore.getLatest?.() || chain[chain.length - 1];
  res.json(latest);
});

app.get('/api/cli/help', (req, res) => {
  const helpText = cliInterface.getHelp?.() || 'CLI commands not available.';
  res.send(`<pre>${helpText}</pre>`);
});


// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`✅ JavaScript-chain server running on port ${PORT}`);
});
