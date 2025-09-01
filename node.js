// node.js — Bagian 1: Setup & Inisialisasi
const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const Blockchain = require('./chain');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const DEFAULT_CONFIG = {
  difficulty: 4,
  totalSupply: 500_000_000,
  premineRatio: 0.05,
  baseReward: 100,
  minReward: 6.25,
  halvingIntervalBlocks: 210000,
  targetBlockTime: 120
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

let ec;
try {
  const EC = require('elliptic').ec;
  ec = new EC('secp256k1');
} catch (_) {}

function makeWallet() {
  const privateKey = crypto.randomBytes(32).toString('hex');
  const publicKey = ec
    ? ec.keyFromPrivate(privateKey, 'hex').getPublic('hex')
    : crypto.randomBytes(33).toString('hex');
  return { publicKey, privateKey };
}

const devWallet = JSON.parse(fs.readFileSync('dev_wallet.json', 'utf8'));
const jsChain = new Blockchain(devWallet.publicKey, CFG);
console.log('🔐 Dev Wallet Public Key:', devWallet.publicKey);

function formatHashrate(h) {
  if (h >= 1e9) return (h / 1e9).toFixed(2) + ' GH/s';
  if (h >= 1e6) return (h / 1e6).toFixed(2) + ' MH/s';
  if (h >= 1e3) return (h / 1e3).toFixed(2) + ' KH/s';
  return h + ' H/s';
}

const minerController = {
  isMining: false,
  workers: [],
  perCore: {},
  bestHash: {},
  totalHashrate: 0,
  activeMiners: [],
  minerAddress: null,
  startedAt: null,
  lastBlockMinedAt: null,
  currentWorkTxs: null
};
function startWorkers(minerAddress) {
  if (minerController.isMining) return;
  minerController.isMining = true;
  minerController.minerAddress = minerAddress;
  minerController.startedAt = Date.now();
  minerController.activeMiners.push(minerAddress);

  const cpuCount = os.cpus().length || 8;
  const workTxs = jsChain.buildWorkTransactions(minerAddress);
  if (!workTxs) return;

  const prevHash = jsChain.getLatestBlock().hash;
  const blockData = prevHash + JSON.stringify(workTxs);
  const difficulty = jsChain.difficulty || 4;

  minerController.perCore = {};
  minerController.bestHash = {};
  minerController.totalHashrate = 0;
  minerController.workers = [];
  minerController.currentWorkTxs = workTxs;

  for (let i = 0; i < cpuCount; i++) {
    const worker = new Worker(path.join(__dirname, 'minerWorker.js'), {
      workerData: { core: i + 1, blockData, difficulty, minerAddress }
    });

    worker.on('message', (msg) => {
      if (msg.found) {
        minerController.bestHash[msg.core] = msg.bestHash;
        minerController.perCore[msg.core] = 0;
        minerController.totalHashrate = Object.values(minerController.perCore).reduce((a, b) => a + b, 0);
        minerController.lastBlockMinedAt = new Date().toISOString();
        stopWorkers();
        const ok = jsChain.addBlockFromWorker(minerController.currentWorkTxs, msg.nonce, msg.hash, minerAddress);
        if (ok) {
          saveChainState();
          setTimeout(() => startWorkers(minerAddress), 100); // auto-loop
        }
      } else {
        minerController.perCore[msg.core] = msg.hashrate;
        minerController.bestHash[msg.core] = msg.bestHash;
        minerController.totalHashrate = Object.values(minerController.perCore).reduce((a, b) => a + b, 0);
      }
    });

    worker.on('error', (err) => console.error(`❌ Worker ${i + 1} error:`, err));
    worker.on('exit', () => {
      minerController.perCore[i + 1] = 0;
      minerController.totalHashrate = Object.values(minerController.perCore).reduce((a, b) => a + b, 0);
    });

    minerController.workers.push(worker);
  }
}

function stopWorkers() {
  if (!minerController.isMining) return;
  for (const w of minerController.workers) {
    try { w.postMessage({ cmd: 'stop' }); w.terminate(); } catch {}
  }
  minerController.workers = [];
  minerController.isMining = false;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/wallets', (req, res) => {
  res.render('wallets', {
    wallets: Object.entries(jsChain.wallets).map(([name, w]) => ({
      name,
      publicKey: w.publicKey
    }))
  });
});

app.post('/wallets/create', (req, res) => {
  let { name } = req.body;
  if (!name) return res.status(400).send('Invalid name');
  let finalName = name;
  let counter = 1;
  while (jsChain.wallets[finalName]) {
    finalName = `${name}${counter++}`;
  }
  const wallet = makeWallet();
  jsChain.createWallet(finalName, wallet);
  res.redirect(`/wallets/${encodeURIComponent(finalName)}`);
});

app.get('/wallets/:name', (req, res) => {
  const w = jsChain.wallets[req.params.name];
  if (!w) return res.status(404).send('Wallet not found');
  res.render('wallet_detail', { name: req.params.name, publicKey: w.publicKey });
});

app.post('/api/transfer', (req, res) => {
  const { fromName, toAddress, amount } = req.body;
  if (!fromName || !toAddress || !amount) return res.status(400).json({ error: 'Missing fields' });
  jsChain.createTransaction(fromName, toAddress, Number(amount));
  res.json({ ok: true });
});

// Explorer main page
app.get('/explorer', (req, res) => {
  res.render('explorer', { jsChain });
});

// Block detail
app.get('/block/:index', (req, res) => {
  const block = jsChain.chain[Number(req.params.index)];
  if (!block) return res.status(404).send('Block not found');
  res.render('block_detail', { block });
});

// Address explorer
app.get('/address/:addr', (req, res) => {
  const txs = jsChain.getTransactionsByWallet(req.params.addr);
  const balance = jsChain.getBalance(req.params.addr);
  res.render('address_detail', { addr: req.params.addr, txs, balance });
});

// Transaction detail
app.get('/tx/:hash', (req, res) => {
  const result = jsChain.getTransactionByHash?.(req.params.hash);
  if (!result) return res.status(404).send('Transaction not found');
  res.render('tx_detail', {
    hash: req.params.hash,
    blockIndex: result.blockIndex,
    tx: result.tx
  });
});

// Search bar
app.get('/search', (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.redirect('/explorer');

  const index = Number(q);
  if (!isNaN(index) && jsChain.chain[index]) {
    return res.redirect(`/block/${index}`);
  }

  const txs = jsChain.getTransactionsByWallet(q);
  if (txs.length > 0) {
    return res.redirect(`/address/${q}`);
  }

  const result = jsChain.getTransactionByHash?.(q);
  if (result) {
    return res.redirect(`/tx/${q}`);
  }

  res.send('🔍 No match found.');
});

// Save chain + metadata + backup
function saveChainState() {
  try {
    const chainPath = path.join(process.cwd(), 'chain.json');
    const metaPath = path.join(process.cwd(), 'chain_meta.json');
    const backupPath = path.join(process.cwd(), `chain_backup_${jsChain.chain.length}.json`);

    const tmp = chainPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(jsChain.chain, null, 2));
    fs.renameSync(tmp, chainPath);

    const meta = {
      height: jsChain.chain.length - 1,
      difficulty: jsChain.difficulty,
      totalSupply: jsChain.totalSupply,
      minedCoins: jsChain.minedCoins,
      reward: jsChain.getCurrentReward(),
      lastBlockTime: jsChain.getLatestBlock().timestamp,
      updatedAt: Date.now()
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    if (jsChain.chain.length % 100 === 0) {
      fs.writeFileSync(backupPath, JSON.stringify(jsChain.chain, null, 2));
    }
  } catch (e) {
    console.error('❌ Failed to save chain state:', e.message);
  }
}

// Mining endpoints
app.get('/miner', (req, res) => {
  res.render('miner_stats', {});
});

app.post('/miner/start', (req, res) => {
  const { minerAddress } = req.body;
  if (!minerAddress) return res.status(400).json({ error: 'minerAddress required' });
  startWorkers(minerAddress);
  res.json({ ok: true });
});

app.post('/miner/stop', (req, res) => {
  stopWorkers();
  res.json({ ok: true });
});

app.post('/mine', (req, res) => {
  try {
    jsChain.minePendingTransactions('miner1');
    saveChainState();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mining stats
app.get('/mining-stats', (req, res) => {
  res.json({
    height: jsChain.chain.length - 1,
    difficulty: jsChain.difficulty,
    reward: jsChain.getCurrentReward(),
    totalHashrate: formatHashrate(minerController.totalHashrate || 0),
    pendingTxCount: jsChain.pendingTransactions.length,
    perCore: minerController.perCore || {},
    bestHash: minerController.bestHash || {},
    lastBlockMinedAt: minerController.lastBlockMinedAt || null,
    startedAt: minerController.startedAt || null,
    miners: minerController.activeMiners || []
  });
});

// Metadata & config endpoints
app.get('/config', (req, res) => {
  res.json(CFG);
});

app.get('/meta', (req, res) => {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'chain_meta.json'), 'utf8'));
    res.json(meta);
  } catch {
    res.status(404).json({ error: 'Metadata not found' });
  }
});

app.get('/backup-list', (req, res) => {
  const files = fs.readdirSync(process.cwd()).filter(f => f.startsWith('chain_backup_'));
  res.json({ backups: files });
});

// Info page
app.get('/about', (req, res) => {
  res.render('about', {
    title: 'Tentang JS-Chain',
    description: 'JS-Chain adalah blockchain modular berbasis JavaScript yang bisa dijalankan dari HP, Termux, atau server ringan.',
    vision: 'Membuka jalur digital yang scalable untuk komunitas global.',
    mission: [
      'Blockchain modular yang developer-friendly',
      'Mining dan explorer langsung dari perangkat mobile',
      'Integrasi domain dan tunnel untuk branding digital'
    ],
    links: {
      explorer: 'https://donated-translation-pretty-paintings.trycloudflare.com/Explorer',
      wallet: 'https://donated-translation-pretty-paintings.trycloudflare.com/wallets',
      miner: 'https://donated-translation-pretty-paintings.trycloudflare.com/miner'
    }
  });
});

// Root
app.get('/', (req, res) => {
  res.send('🟢 JS-Chain Node running. Visit /explorer, /wallets, /miner, or /about');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🟢 Node running at http://localhost:${PORT}`);
});
