const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { Worker } = require('worker_threads');
const crypto = require('crypto'); // ✅ untuk salt random
const Blockchain = require('./chain');
const { generateWallet } = require('./wallet');

const config = JSON.parse(fs.readFileSync('./config.json'));
const minerWallet = generateWallet('miner');
const jsChain = new Blockchain(minerWallet.publicKey, config);

console.log(`⛏️ Miner started`);
console.log(`🔐 Wallet:\nPublic: ${minerWallet.publicKey}`);
console.log(`💰 Initial balance: ${jsChain.getBalance(minerWallet.publicKey)}`);

const minerController = {
  isMining: false,
  workers: [],
  perCore: {},
  bestHash: {},
  totalHashrate: 0,
  activeMiners: [],
  minerAddress: minerWallet.publicKey,
  startedAt: null,
  lastBlockMinedAt: null
};

function formatHashrate(h) {
  if (h >= 1e9) return (h / 1e9).toFixed(2) + ' GH/s';
  if (h >= 1e6) return (h / 1e6).toFixed(2) + ' MH/s';
  if (h >= 1e3) return (h / 1e3).toFixed(2) + ' KH/s';
  return h + ' H/s';
}

const app = express();
app.use(express.json());

/**
 * Monitoring endpoint
 */
app.get('/mining-stats', (req, res) => {
  const uptime = minerController.startedAt ? Math.floor((Date.now() - minerController.startedAt) / 1000) : 0;
  const blocksMined = jsChain.chain.length - 1;
  const avgHashrate = Object.values(minerController.perCore).length > 0
    ? Math.floor(Object.values(minerController.perCore).reduce((a, b) => a + b, 0) / Object.values(minerController.perCore).length)
    : 0;
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
    miners: minerController.activeMiners || [],
    uptime,
    blocksMined,
    avgHashrate
  });
});

/**
 * Endpoint untuk client ambil tugas mining
 */
app.get('/mining-task', (req, res) => {
  const latestBlock = jsChain.getLatestBlock();
  const txs = jsChain.buildWorkTransactions(minerWallet.publicKey);

  // ✅ Tambahkan salt random di rewardTx
  txs.push({
    from: 'SYSTEM',
    to: minerWallet.publicKey,
    amount: jsChain.getCurrentReward(),
    salt: crypto.randomBytes(16).toString('hex')
  });

  res.json({
    index: jsChain.chain.length,
    previousHash: latestBlock.hash,
    transactions: txs,
    difficulty: jsChain.difficulty,
    minerAddress: minerWallet.publicKey,
    timestamp: Date.now()
  });
});

/**
 * Endpoint untuk client submit block hasil mining
 */
app.post('/submit-block', (req, res) => {
  const { transactions, nonce, hash, minerAddress, previousHash } = req.body;
  const latestBlock = jsChain.getLatestBlock();

  if (previousHash !== latestBlock.hash) {
    return res.json({ status: 'rejected', reason: 'Invalid previousHash' });
  }
  if (!hash.startsWith('0'.repeat(jsChain.difficulty))) {
    return res.json({ status: 'rejected', reason: 'Hash does not meet difficulty' });
  }
  if (jsChain.chain.find(b => b.hash === hash)) {
    return res.json({ status: 'rejected', reason: 'Duplicate block hash' });
  }

  const success = jsChain.addBlockFromWorker(transactions, nonce, hash, minerAddress);
  if (success) {
    minerController.lastBlockMinedAt = Date.now();
    console.log(`✅ Block submitted by ${minerAddress}, hash: ${hash}`);
    res.json({ status: 'accepted', height: jsChain.chain.length - 1 });
  } else {
    res.json({ status: 'rejected', reason: 'Block not accepted' });
  }
});

/**
 * Start mining lokal (multi-core)
 */
function startMining() {
  if (minerController.isMining) {
    console.log(`⚠️ Already mining`);
    return;
  }
  minerController.isMining = true;
  minerController.startedAt = Date.now();

  const txs = jsChain.buildWorkTransactions(minerWallet.publicKey);
  txs.push({
    from: 'SYSTEM',
    to: minerWallet.publicKey,
    amount: jsChain.getCurrentReward(),
    salt: crypto.randomBytes(16).toString('hex')
  });

  console.log(`📥 Pending transactions: ${txs.length}`);

  const cpuCount = (os.cpus() && os.cpus().length) ? os.cpus().length : 1;
  console.log(`⛏️ Mining started on ${cpuCount} cores...`);

  for (let i = 0; i < cpuCount; i++) {
    const worker = new Worker(path.join(__dirname, 'minerWorker.js'), {
      workerData: {
        core: i,
        index: jsChain.chain.length,
        previousHash: jsChain.getLatestBlock().hash,
        timestamp: Date.now(),
        transactions: JSON.stringify(txs),
        difficulty: jsChain.difficulty,
        minerAddress: minerWallet.publicKey
      }
    });

    minerController.workers.push(worker);
    minerController.activeMiners.push(`core-${i}`);

    worker.on('message', msg => {
      if (msg.found) {
        console.log(`✅ Block mined by core ${msg.core}, hash: ${msg.hash}`);
        minerController.lastBlockMinedAt = Date.now();

        if (jsChain.chain.find(b => b.hash === msg.hash)) {
          console.log(`⚠️ Duplicate block hash detected, rejected`);
          return;
        }

        const success = jsChain.addBlockFromWorker(msg.transactions, msg.nonce, msg.hash, msg.minerAddress);
        if (success) {
          console.log(`📦 Block added to chain at height ${jsChain.chain.length - 1}`);
          console.log(`💰 Miner balance: ${jsChain.getBalance(minerWallet.publicKey)}`);
        }

        console.log(`📡 Broadcasting new block index ${jsChain.chain.length} to all workers`);
        minerController.workers.forEach(w => {
          const txs = jsChain.buildWorkTransactions(minerWallet.publicKey);
          txs.push({
            from: 'SYSTEM',
            to: minerWallet.publicKey,
            amount: jsChain.getCurrentReward(),
            salt: crypto.randomBytes(16).toString('hex')
          });

          w.postMessage({
            cmd: 'update',
            index: jsChain.chain.length,
            previousHash: jsChain.getLatestBlock().hash,
            transactions: JSON.stringify(txs),
            difficulty: jsChain.difficulty,
            timestamp: Date.now()
          });
        });
      } else {
        minerController.perCore[msg.core] = msg.hashrate || 0;
        minerController.bestHash[msg.core] = msg.bestHash || 'N/A';
        minerController.totalHashrate = Object.values(minerController.perCore)
          .reduce((a, b) => a + b, 0);

        console.log(`⛏️ Update from core-${msg.core}: ${msg.hashrate} H/s, bestHash: ${msg.bestHash}`);
        console.log(`🌐 Total Hashrate: ${minerController.totalHashrate} H/s`);
      }
    });

    worker.on('error', err => {
      console.error(`❌ Worker error on core ${i}: ${err.message}`);
    });

    worker.on('exit', code => {
      if (code !== 0) {
        console.error(`⚠️ Worker on core ${i} exited with code ${code}`);
      }
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 Miner API running at http://0.0.0.0:${PORT}`);
  startMining();
});
