// --- Core Imports ---
const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { Worker } = require('worker_threads');
const Blockchain = require('./chain');
const walletManager = require('./walletManager'); // sudah diubah ke Ethereum-style
const setupRPC = require('./rpcAdapter');
const os = require('os');

// --- Auth Imports ---
const session = require('express-session');
const bcrypt = require('bcryptjs');

// --- Config ---
const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const DEFAULT_CONFIG = {
  difficulty: 0,
  totalSupply: 500_000_000,
  premineRatio: 0.05,
  baseReward: 100,
  minReward: 6.25,
  halvingIntervalBlocks: 210000,
  targetBlockTime: 120,
  enableMining: true,
  enablePool: true,
  enableP2P: true,
  useWorkerThreads: true,
  wsPort: 3001,
  chainId: 102,
  networkId: 102,
  rpcUrl: "http://localhost:3000",
  explorerUrl: "http://localhost:3000/explorer"
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...DEFAULT_CONFIG, ...cfg };
    }
  } catch (e) {
    console.warn('⚠️ Failed to read config.json:', e.message);
  }
  return DEFAULT_CONFIG;
}
const CFG = loadConfig();

// --- Blockchain Init ---
const jsChain = new Blockchain(null, CFG);

// --- Miner Controller ---
const minerController = {
  activeMiners: {},
  perCore: {},
  bestHash: {},
  totalHashrate: 0,
  lastBlockMinedAt: null,
  totalShares: 0
};

// --- Pool Miner Tracking ---
let miners = {};
let difficultyPrefix = '0'.repeat(CFG.difficulty || 2);
jsChain.setDifficulty(difficultyPrefix);

// --- Express Setup ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.set('trust proxy', 1);

// --- Session Setup ---
app.use(session({
  secret: 'jschain-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // kalau pakai HTTPS bisa true
}));

// --- Rate Limit ---
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5000,
  message: { status: 'error', reason: 'Too many requests, slow down!' }
});
app.use(limiter);

// ================= MINING ROUTES =================

app.get('/mining-task', (req, res) => {
  const minerAddr = req.query.minerAddress || "SYSTEM_NODE";
  const latestBlock = jsChain.getLatestBlock();
  const txs = jsChain.buildWorkTransactions(minerAddr);
  const taskTimestamp = Date.now();
  const nextIndex = jsChain.chain.length;

  res.json({
    index: nextIndex,
    previousHash: latestBlock.hash,
    difficulty: difficultyPrefix,
    timestamp: taskTimestamp,
    transactions: txs,
    startNonce: 0,
    endNonce: 1000000
  });
});

app.post('/submit-block', (req, res) => {
  const { index, previousHash, transactions, nonce, hash, minerAddress, timestamp } = req.body;
  const ok = jsChain.addBlockFromWorker(transactions, nonce, hash, minerAddress, timestamp);

  if (!ok) {
    return res.status(400).json({ status: 'rejected', reason: 'Invalid hash/mismatch' });
  }

  // Difficulty Adaptif
  const chain = jsChain.chain;
  if (chain.length > 1) {
    const latest = chain[chain.length - 1];
    const prev = chain[chain.length - 2];
    const blockTime = latest.timestamp - prev.timestamp;
    if (blockTime < CFG.targetBlockTime * 1000 && difficultyPrefix.length < 6) {
      difficultyPrefix += '0';
    } else if (blockTime > CFG.targetBlockTime * 2000 && difficultyPrefix.length > 1) {
      difficultyPrefix = difficultyPrefix.slice(0, -1);
    }
    jsChain.setDifficulty(difficultyPrefix);
  }

  // Update miner stats
  if (!minerController.activeMiners[minerAddress]) {
    minerController.activeMiners[minerAddress] = { shares: 0, blocks: 0, reward: 0 };
  }
  minerController.activeMiners[minerAddress].blocks++;
  minerController.activeMiners[minerAddress].reward += jsChain.getCurrentReward();
  minerController.activeMiners[minerAddress].lastSeen = new Date().toLocaleString();

  minerController.lastBlockMinedAt = Date.now();

  const rewardTxs = transactions.filter(tx => tx.from === 'SYSTEM');
  res.json({ status: 'accepted', index, hash, rewardTxs });
});

// ================= AUTH ROUTES =================

// Middleware proteksi login
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login?error=Harus login dulu');
  }
  next();
}

// Halaman registrasi
app.get('/register', (req, res) => {
  res.render('register', {
    successMessage: req.query.success || null,
    errorMessage: req.query.error || null
  });
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect('/register?error=Invalid input');

  let users = [];
  if (fs.existsSync('users.json')) {
    users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
  }

  if (users.find(u => u.username === username)) {
    return res.redirect('/register?error=User sudah ada');
  }

  const hash = bcrypt.hashSync(password, 10);
  users.push({ username, passwordHash: hash });
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
  res.redirect('/login?success=Registrasi berhasil');
});

// Halaman login
app.get('/login', (req, res) => {
  res.render('login', {
    successMessage: req.query.success || null,
    errorMessage: req.query.error || null
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  let users = [];
  if (fs.existsSync('users.json')) {
    users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
  }

  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.redirect('/login?error=Login gagal');
  }

  req.session.user = username;
  res.redirect('/wallets');
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login?success=Logout berhasil');
  });
});

// ================= WALLET ROUTES (Ethereum-style) =================

app.get('/wallets', requireLogin, (req, res) => {
  res.render('wallets', {
    wallets: walletManager.getAllForUser(req.session.user),
    successMessage: req.query.success || null,
    errorMessage: req.query.error || null
  });
});

app.post('/wallets/create', requireLogin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.redirect('/wallets?error=Invalid name');
  const wallet = walletManager.generateEthereumWalletForUser(req.session.user, name);
  res.redirect('/wallets?success=Wallet berhasil dibuat');
});

app.post('/wallets/import', requireLogin, (req, res) => {
  const { name, walletJson } = req.body;
  try {
    const parsed = JSON.parse(walletJson);
    walletManager.saveWalletForUser(req.session.user, name, parsed);
    res.redirect('/wallets?success=Wallet berhasil diimport');
  } catch (e) {
    res.redirect('/wallets?error=Import gagal');
  }
});

app.get('/wallets/:name', requireLogin, (req, res) => {
  const wallet = walletManager.loadWalletForUser(req.session.user, req.params.name);
  if (!wallet) return res.status(404).send('Not found');
  res.render('wallet_detail', { 
    name: wallet.name, 
    publicKey: wallet.publicKey, 
    address: wallet.address // Ethereum-style 0x...
  });
});

app.get('/wallets/:name/history', requireLogin, (req, res) => {
  const wallet = walletManager.loadWalletForUser(req.session.user, req.params.name);
  if (!wallet) return res.status(404).send('Not found');
  res.render('wallet_history', { 
    name: wallet.name, 
    history: jsChain.getTransactionsByWallet(wallet.address) 
  });
});

app.get('/wallets/:name/export', requireLogin, (req, res) => {
  const wallet = walletManager.loadWalletForUser(req.session.user, req.params.name);
  if (!wallet) return res.status(404).json({ error: 'Not found' });
  res.json(wallet);
});

app.post('/wallets/:name/delete', requireLogin, (req, res) => {
  walletManager.deleteWalletForUser(req.session.user, req.params.name);
  res.redirect('/wallets?success=Wallet berhasil dihapus');
});

// ================= METAMASK ROUTES =================
app.post('/metamask/connect', requireLogin, (req, res) => {
  const { address } = req.body;
  if (!address) {
    return res.json({ ok: false, error: 'No address provided' });
  }
  // Simpan address ke session user
  req.session.metamaskAddress = address;
  console.log("MetaMask connected:", address);
  res.json({ ok: true, msg: 'MetaMask connected', address });
});

// ================= MINER DASHBOARD =================
app.get('/miner', (req, res) => {
  res.render('miner_stats');
});

// ================= EXPLORER & SEARCH =================
app.get('/explorer', (req, res) => {
  res.render('explorer', {
    chain: jsChain.chain,
    difficulty: difficultyPrefix,
    reward: jsChain.getCurrentReward(),
    height: jsChain.chain.length - 1,
    peersCount: 0,
    // Tambahan ini bro:
    highlightAddress: req.session.metamaskAddress || null
  });
});

app.get('/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.redirect('/explorer');
  const blockByIndex = jsChain.chain.find(b => b.index == q);
  if (blockByIndex) return res.redirect(`/block/${blockByIndex.index}`);
  const blockByHash = jsChain.chain.find(b => b.hash === q);
  if (blockByHash) return res.redirect(`/block/${blockByHash.index}`);
  const txSearch = jsChain.getTransactionByHash?.(q);
  if (txSearch) return res.redirect(`/tx/${q}`);
  res.redirect('/explorer');
});

app.get('/block/:index', (req, res) => {
  const block = jsChain.chain[Number(req.params.index)];
  if (!block) return res.status(404).send('Not found');
  res.render('block_detail', { block });
});

app.get('/tx/:hash', (req, res) => {
  const tx = jsChain.getTransactionByHash?.(req.params.hash);
  if (!tx) return res.status(404).send('Not found');
  res.render('tx_detail', { tx: tx.tx, hash: req.params.hash, blockIndex: tx.blockIndex });
});

app.get('/address/:addr', (req, res) => {
  const balance = jsChain.getBalance(req.params.addr);
  const txs = jsChain.getTransactionsByWallet(req.params.addr);
  res.render('address_detail', { addr: req.params.addr, balance, txs });
});

// ================= API JSON ROUTES =================

app.get('/api/chain', (req, res) => res.json(jsChain.chain));
app.get('/api/status', (req, res) => res.json({
  height: jsChain.chain.length - 1,
  difficulty: difficultyPrefix,
  reward: jsChain.getCurrentReward(),
  activeMiners: Object.keys(minerController.activeMiners)
}));
app.get('/api/block/:index', (req, res) => res.json(jsChain.chain[req.params.index]));

// ================= MINER STATS API =================

app.get('/miner-stats', (req, res) => {
  const activeMinerKeys = Object.keys(minerController.activeMiners);

  const miners = activeMinerKeys.map(addr => {
    const state = minerController.activeMiners[addr];
    return {
      address: addr, // Ethereum-style address
      shares: state.shares || 0,
      blocks: state.blocks || 0,
      totalReward: state.reward || 0,
      contributionPercent: minerController.totalShares > 0
        ? ((state.shares || 0) / minerController.totalShares * 100).toFixed(2) + "%"
        : "0%",
      lastSeen: state.lastSeen || new Date().toLocaleString()
    };
  });

  res.json({
    difficulty: difficultyPrefix,
    activeMiners: activeMinerKeys,
    minerCount: activeMinerKeys.length,
    totalShares: miners.reduce((sum, m) => sum + m.shares, 0),
    avgBlockTimeMs: CFG.targetBlockTime * 1000,
    miners
  });
});

app.get('/chain-stats', (req, res) => {
  res.json({
    height: jsChain.chain.length - 1,
    blocks: jsChain.chain.length
  });
});

// ================= MINER CONTROL =================

let PORT = process.env.PORT || 3000;
function startWorker(minerAddress, coreId = 0) {
  if (!minerController.activeMiners[minerAddress]) {
    minerController.activeMiners[minerAddress] = { isMining: true, shares: 0, blocks: 0, reward: 0 };
  }
  const worker = new Worker(path.join(__dirname, 'minerWorker.js'), {
    workerData: { core: coreId, nodeUrl: `http://localhost:${PORT}`, minerAddress }
  });
  worker.on('message', msg => {
    if (msg.hashrate) {
      minerController.perCore[minerAddress] = msg.hashrate;
      minerController.activeMiners[minerAddress].shares += msg.hashrate;
      minerController.totalShares += msg.hashrate;
      minerController.totalHashrate += msg.hashrate;
    }
    if (msg.bestHash) minerController.bestHash[minerAddress] = msg.bestHash;
    minerController.activeMiners[minerAddress].lastSeen = new Date().toLocaleString();
  });
  minerController.activeMiners[minerAddress].worker = worker;
}

app.post('/miner/start', (req, res) => {
  const { minerAddress } = req.body;
  if (!minerAddress) return res.status(400).json({ error: 'Address required' });
  startWorker(minerAddress);
  res.json({ ok: true, miner: minerAddress, msg: "Mining started" });
});

app.post('/miner/stop', async (req, res) => {
  const { minerAddress } = req.body;
  const state = minerController.activeMiners[minerAddress];
  if (state && state.worker) await state.worker.terminate();
  delete minerController.activeMiners[minerAddress];
  res.json({ ok: true, msg: "Mining stopped" });
});

// ================= HOME & START =================

app.get(['/', '/home'], (req, res) => {
  const chain = jsChain.chain;
  const latestBlock = chain.length ? chain[chain.length - 1] : null;

  // Ambil semua transaksi
  const allTxs = chain.flatMap(b => b.transactions || []);

  // Filter hanya transaksi valid (punya hash)
  const validTxs = allTxs.filter(tx => tx && tx.hash);

  res.render('home', {
    // Stats Card
    latestBlock: latestBlock ? latestBlock.index : 0,
    txCount: validTxs.length,
    walletCount: walletManager.getAll().length,
    peerCount: 0,
    difficulty: difficultyPrefix,
    totalSupply: CFG.totalSupply,

    // Dashboard transaksi
    transactions: validTxs.slice(-10).reverse(),

    // Footer info
    chainVersion: 'v1.0.0',
    latestHash: latestBlock ? latestBlock.hash : 'N/A',
    nodeStatus: 'Online'
  });
});

// ================= RPC SETUP =================

setupRPC(app, jsChain, walletManager);

// ================= SERVER START =================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 Super Node running at http://localhost:${PORT}`);
});
