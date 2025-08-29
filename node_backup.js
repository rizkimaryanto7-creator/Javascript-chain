const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // untuk hitung publicKey dari privateKey
const os = require('os');
const { Worker } = require('worker_threads');

const Blockchain = require('./chain');
const { generateWallet } = require('./wallet');

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.use(express.static('public'));

// ===== Inisialisasi Wallet & Blockchain =====

// Private key premine fix (pastikan ini milik wallet premine awal)
const PREMINE_PRIV = '5386f909abf5af0fd71058a7727e5170bd2bf839c6eecbe3ffe11e46ebc65f9e';
const PREMINE_PUB = crypto.createHash('sha256').update(PREMINE_PRIV).digest('hex');

// Buat instance blockchain dengan alamat premine fix
const jsChain = new Blockchain(PREMINE_PUB);

// ========== Mining controller state & helpers ==========
let minerController = {
  isMining: false,
  minerAddress: null,
  workers: [],
  perCore: {},          // { 1: H/s, 2: H/s, ... }
  totalHashrate: 0,     // total H/s semua core
  lastPrevHash: null,
  difficulty: null,
  reward: null,
  startedAt: null
};

// Helper: buat seed hash untuk worker berdasarkan state chain
function buildSeed(minerAddress) {
  const prevBlock = jsChain.chain[jsChain.chain.length - 1];
  const prevHash = prevBlock?.hash || 'genesis';
  minerController.lastPrevHash = prevHash;
  minerController.difficulty = jsChain.difficulty ?? null;
  minerController.reward = jsChain.miningReward ?? null;
  return `${prevHash}:${minerAddress}:${Date.now()}`;
}

// Start worker threads per-core
function startWorkers(minerAddress) {
  if (minerController.isMining) return;

  minerController.isMining = true;
  minerController.minerAddress = minerAddress;
  minerController.startedAt = Date.now();

  // Fallback 8 core kalau os.cpus() return 0
  let cpuCount = os.cpus().length;
  if (cpuCount === 0) {
    console.warn('⚠️ os.cpus() return 0, fallback ke 8 core');
    cpuCount = 8;
  }

  // Ambil data blok untuk mining (PoW)
  const prevBlock = jsChain.getLatestBlock();
  const blockData = prevBlock.hash + JSON.stringify(jsChain.pendingTransactions);
  const difficulty = jsChain.difficulty || 4;

  minerController.perCore = {};
  minerController.bestHash = {};
  minerController.totalHashrate = 0;
  minerController.workers = [];

  for (let i = 0; i < cpuCount; i++) {
    const worker = new Worker(
      path.join(__dirname, 'minerWorker.js'),
      { workerData: { core: i + 1, blockData, difficulty, minerAddress } }
    );

    console.log(`🚀 Worker thread untuk Core ${i + 1} dibuat`);

    worker.on('message', (msg) => {
      if (msg.found) {
        console.log(`✅ Core ${msg.core} menemukan blok! Nonce: ${msg.nonce}, Hash: ${msg.hash}`);
        minerController.bestHash[msg.core] = msg.bestHash;
        minerController.perCore[msg.core] = 0;
        minerController.totalHashrate = Object.values(minerController.perCore).reduce((a, b) => a + b, 0);
        minerController.lastBlockMinedAt = new Date().toISOString();
        stopWorkers();
        // Tambahkan blok ke blockchain
        jsChain.addBlockFromWorker(jsChain.pendingTransactions, msg.nonce, msg.hash, msg.minerAddress);
      } else {
        minerController.perCore[msg.core] = msg.hashrate;
        minerController.bestHash[msg.core] = msg.bestHash;
        minerController.totalHashrate = Object.values(minerController.perCore).reduce((a, b) => a + b, 0);
        console.log(`Core ${msg.core}: ${msg.hashrate} H/s | Best: ${msg.bestHash}`);
      }
    });

    worker.on('error', (err) => {
      console.error(`❌ Worker core ${i + 1} error:`, err);
    });

    worker.on('exit', () => {
      minerController.perCore[i + 1] = 0;
      minerController.totalHashrate = Object.values(minerController.perCore).reduce((a, b) => a + b, 0);
      console.log(`⚠️ Worker core ${i + 1} berhenti`);
    });

    minerController.workers.push(worker);
  }

  console.log(`⛏️ Mining monitor started for ${minerAddress} on ${cpuCount} core(s)`);
}

// Stop semua worker
function stopWorkers() {
  if (!minerController.isMining) return;
  minerController.isMining = false;
  minerController.workers.forEach(w => w.terminate());
  minerController.workers = [];
  console.log('🛑 Mining monitor stopped');
}

// ===== Routes untuk UI miner =====
app.get('/miner', (req, res) => {
  res.render('miner_stats', {
    height: jsChain.chain.length,
    difficulty: jsChain.difficulty ?? null,
    reward: jsChain.miningReward ?? null
  });
});

app.post('/miner/start', (req, res) => {
  const minerAddress = (req.body.minerAddress || '').trim().toLowerCase();
  if (!minerAddress || minerAddress.length < 10) {
    return res.status(400).json({ error: 'Miner address tidak valid' });
  }
  startWorkers(minerAddress);
  return res.json({ status: 'started', minerAddress });
});

app.post('/miner/stop', (req, res) => {
  stopWorkers();
  return res.json({ status: 'stopped' });
});

app.get('/mining-stats', (req, res) => {
  res.json({
    isMining: minerController.isMining,
    miner: minerController.minerAddress,
    perCore: minerController.perCore,
    totalHashrate: minerController.totalHashrate,
    difficulty: jsChain.difficulty ?? minerController.difficulty,
    reward: jsChain.miningReward ?? minerController.reward,
    height: jsChain.chain.length,
    prevHash: minerController.lastPrevHash,
    startedAt: minerController.startedAt
  });
});

app.post('/mine', async (req, res) => {
  const minerAddress = (req.body.minerAddress || '').trim().toLowerCase();
  if (!minerAddress || minerAddress.length < 10) {
    return res.status(400).json({ error: 'Miner address tidak valid' });
  }
  try {
    await jsChain.minePendingTransactions(minerAddress);
    if (minerController.isMining) {
      stopWorkers();
      startWorkers(minerAddress);
    }
    return res.json({ status: 'mined', height: jsChain.chain.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Mining gagal' });
  }
});

// Load wallet dari file kalau ada
jsChain.loadWallets?.();

// Tambah wallet premine kalau belum ada
if (!jsChain.wallets['rizki']) {
  jsChain.createWallet('rizki', { privateKey: PREMINE_PRIV, publicKey: PREMINE_PUB });
}

// Tambah wallet miner kalau belum ada
if (!jsChain.wallets['miner1']) {
  const minerWallet = generateWallet();
  jsChain.createWallet('miner1', minerWallet);
}

// Load blockchain dari file jika ada
jsChain.loadChain?.();

// Premine transaksi hanya kalau chain kosong
if (jsChain.chain.length === 0) {
  const premineTx = {
    from: 'SYSTEM',
    to: PREMINE_PUB,
    amount: 25000000
  };
  jsChain.pendingTransactions.push(premineTx);
  jsChain.minePendingTransactions('miner1');
}

// ✅ Daftar wallet diambil langsung dari blockchain (dinamis)
const walletList = Object.keys(jsChain.wallets).map(name => ({
  name,
  publicKey: jsChain.wallets[name].publicKey
}));

app.get('/', (req, res) => {
  res.render('index', { chain: jsChain.chain, wallets: walletList });
});

// 🌐 Halaman kirim transaksi
app.get('/send', (req, res) => {
  res.render('send');
});

app.post('/send', (req, res) => {
  const { from, to, amount } = req.body;
  jsChain.createTransaction(from, to, parseFloat(amount));
  res.redirect('/');
});

app.get('/transactions', (req, res) => {
  res.render('transactions', { chain: jsChain.chain });
});

// 💰 Cek saldo wallet
app.get('/balance', (req, res) => {
  const publicKey = req.query.publicKey;
  const balance = publicKey ? jsChain.getBalance(publicKey) : undefined;
  res.render('balance', { balance });
});

// 🔍 Detail blok
app.get('/block/:id', (req, res) => {
  const block = jsChain.chain[parseInt(req.params.id)];
  if (!block) return res.send('Block not found');
  res.render('block', { block });
});

app.post('/sync', (req, res) => {
  const incomingChain = req.body.chain;
  if (incomingChain.length > jsChain.chain.length) {
    jsChain.chain = incomingChain;
    jsChain.saveChain();
    res.json({ status: 'Chain replaced' });
  } else {
    res.json({ status: 'Chain ignored' });
  }
});

app.get('/wallets', (req, res) => {
  const walletList = Object.keys(jsChain.wallets).map(name => ({
    name,
    publicKey: jsChain.wallets[name].publicKey
  }));
  res.render('wallets', { walletList });
});

app.get('/wallet/:name', (req, res) => {
  const walletName = req.params.name.toLowerCase();
  const wallet = jsChain.wallets[walletName];

  if (!wallet) return res.send(`❌ Wallet '${walletName}' tidak ditemukan`);

  // Pake fungsi saldo yang sesuai di Blockchain class
  const balance = jsChain.getBalanceOfAddress
    ? jsChain.getBalanceOfAddress(wallet.publicKey)
    : jsChain.getBalance(wallet.publicKey);

  res.render('wallet_detail', {
    name: walletName,
    publicKey: wallet.publicKey,
    privateKey: wallet.privateKey,
    balance
  });
});

app.post('/wallet/send', (req, res) => {
  const { from, to, amount } = req.body;
  jsChain.createTransaction(from, to, parseFloat(amount));
  res.redirect(`/wallet/${from}`);
});

// 🔐 Endpoint: Buat wallet baru
app.post('/wallet', (req, res) => {
  const { name } = req.body;
  const wallet = generateWallet();
  jsChain.createWallet(name, wallet);
  res.json(wallet);
});

// 💸 Endpoint: Buat transaksi
app.post('/transaction', (req, res) => {
  const { from, to, amount } = req.body;
  jsChain.createTransaction(from, to, amount);
  res.json({ status: 'Transaction created' });
});

// ⛏️ Endpoint: Mining manual
app.get('/mine', (req, res) => {
  jsChain.minePendingTransactions('miner1');
  res.json({ status: 'Block mined' });
});

// 📦 Endpoint: Ambil blockchain
app.get('/chain', (req, res) => {
  res.json(jsChain.chain);
});

// 💰 Endpoint: Cek saldo wallet
app.get('/balance/:publicKey', (req, res) => {
  const balance = jsChain.getBalance(req.params.publicKey);
  res.json({ balance });
});

// 📜 Endpoint: Histori transaksi wallet
app.get('/wallet/:name/history', (req, res) => {
  const name = req.params.name;
  const wallet = jsChain.wallets[name];
  if (!wallet) return res.send('❌ Wallet tidak ditemukan');

  const history = jsChain.getTransactionsByWallet(wallet.publicKey);
  res.render('wallet_history', { name, history });
});

// 📤 Export Wallet
app.get('/wallet/:name/export', (req, res) => {
  const name = req.params.name;
  const wallet = jsChain.wallets[name];
  if (!wallet) return res.status(404).send('❌ Wallet tidak ditemukan');

  const filePath = path.join(__dirname, `wallet_${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(wallet, null, 2));
  res.download(filePath, `wallet_${name}.json`, (err) => {
    if (err) {
      console.error(err);
      res.status(500).send('❌ Gagal mengunduh file wallet');
    }
  });
});

// 📥 Import Wallet
app.post('/wallet/import', (req, res) => {
  const { name, privateKey } = req.body;
  if (!name || !privateKey) {
    return res.send('❌ Nama wallet & Private Key wajib diisi');
  }

  try {
    const key = ec.keyFromPrivate(privateKey, 'hex');
    const importedWallet = {
      privateKey,
      publicKey: key.getPublic('hex')
    };
    jsChain.createWallet(name, importedWallet);
    fs.writeFileSync(`wallet_${name}.json`, JSON.stringify(importedWallet, null, 2));
    console.log(`✅ Wallet '${name}' berhasil di-import`);
    res.redirect(`/wallet/${name}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Gagal import wallet. Private key mungkin salah.');
  }
});

// 🚀 Jalankan server + WebSocket
const http = require('http');
const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastNewBlock(block) {
  const data = JSON.stringify({ type: 'newBlock', block });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🟢 Node + WebSocket running at http://localhost:${PORT}`);
});
