const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { loadWallet } = require('./wallet');

// 🔐 Load wallet
const wallet = loadWallet();
if (!wallet) {
  console.error('❌ Wallet belum dibuat. Jalankan: node wallet.js generate');
  process.exit(1);
}

// 📂 Path chain.json
const chainPath = path.join(process.cwd(), 'chain.json');
if (!fs.existsSync(chainPath)) {
  console.error('❌ chain.json tidak ditemukan. Buat Genesis block dulu.');
  process.exit(1);
}

// 🔑 Fungsi hashing
function scripthash(data, nonce) {
  return crypto.createHash('sha256')
    .update(data + nonce)
    .digest('hex');
}

// 📥 Load chain
function loadChain() {
  const raw = fs.readFileSync(chainPath, 'utf8');
  return JSON.parse(raw);
}

// 💾 Save chain
function saveChain(chain) {
  fs.writeFileSync(chainPath, JSON.stringify(chain, null, 2), 'utf8');
}

// ⛏️ Mining block
function mineBlock() {
  const chain = loadChain();
  const lastBlock = chain[chain.length - 1];
  const previousHash = lastBlock.hash;
  const index = lastBlock.index + 1;
  const timestamp = Date.now();

  const rewardTx = {
    from: 'SYSTEM',
    to: wallet.publicKey,
    amount: 100,
    salt: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now()   // ✅ tambahin ini
  };

  let nonce = 0;
  let hash = '';
  const difficultyPrefix = '0000';

  console.log(`⛏️ Mining block #${index}...`);

  while (true) {
    hash = scripthash(JSON.stringify(rewardTx) + previousHash + timestamp, nonce);
    if (hash.startsWith(difficultyPrefix)) break;
    nonce++;
  }

  const newBlock = { index, timestamp, transactions: [rewardTx], previousHash, nonce, hash };

  if (chain.find(b => b.hash === hash)) {
    console.log(`⚠️ Duplicate block hash detected, rejected`);
    return;
  }

  chain.push(newBlock);
  saveChain(chain);

  console.log(`✅ Block #${index} mined!`);
  console.log(`🧱 Hash: ${hash}`);
  console.log(`🎁 Reward sent to: ${wallet.publicKey}`);
}

// 🔁 Loop tiap 2 menit
setInterval(() => {
  mineBlock();
}, 2 * 60 * 1000);

console.log('🌀 Auto miner started. Mining block setiap 2 menit...');

// 🌐 Express API
const app = express();
app.use(express.json());

// Monitoring
app.get('/chain-stats', (req, res) => {
  const chain = loadChain();
  const lastBlock = chain[chain.length - 1];
  res.json({
    height: chain.length - 1,
    lastHash: lastBlock.hash,
    lastIndex: lastBlock.index,
    lastTimestamp: lastBlock.timestamp,
    wallet: wallet.publicKey,
    blocks: chain.length
  });
});

// Mining task untuk client
app.get('/mining-task', (req, res) => {
  const chain = loadChain();
  const lastBlock = chain[chain.length - 1];
  const rewardTx = {
    from: 'SYSTEM',
    to: wallet.publicKey,
    amount: 100,
    salt: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now()   // ✅ tambahin ini
  };
  res.json({
    index: lastBlock.index + 1,
    previousHash: lastBlock.hash,
    transactions: [rewardTx],
    difficulty: '0000',
    minerAddress: wallet.publicKey,
    timestamp: Date.now()
  });
});

// Submit block dari client
app.post('/submit-block', (req, res) => {
  const { index, previousHash, transactions, nonce, hash, minerAddress } = req.body;
  const chain = loadChain();
  const lastBlock = chain[chain.length - 1];

  if (previousHash !== lastBlock.hash) {
    return res.json({ status: 'rejected', reason: 'Invalid previousHash' });
  }
  if (!hash.startsWith('0000')) {
    return res.json({ status: 'rejected', reason: 'Hash does not meet difficulty' });
  }
  if (chain.find(b => b.hash === hash)) {
    return res.json({ status: 'rejected', reason: 'Duplicate block hash' });
  }

  const newBlock = { index, timestamp: Date.now(), transactions, previousHash, nonce, hash };
  chain.push(newBlock);
  saveChain(chain);

  console.log(`✅ Block #${index} submitted by ${minerAddress}, hash: ${hash}`);
  res.json({ status: 'accepted', height: chain.length - 1 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 Full Node API running at http://0.0.0.0:${PORT}`);
  console.log(`📡 Endpoints: /chain-stats, /mining-task, /submit-block`);
});
