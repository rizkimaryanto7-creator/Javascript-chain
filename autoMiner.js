const fs = require('fs');
const path = require('path');
const { loadWallet, scripthash } = require('./wallet');

const wallet = loadWallet();
if (!wallet) {
  console.error('❌ Wallet belum dibuat. Jalankan: node wallet.js generate');
  process.exit(1);
}

const chainPath = path.join(process.cwd(), 'chain.json');
if (!fs.existsSync(chainPath)) {
  console.error('❌ chain.json tidak ditemukan. Buat Genesis block dulu.');
  process.exit(1);
}

function loadChain() {
  const raw = fs.readFileSync(chainPath, 'utf8');
  return JSON.parse(raw);
}

function saveChain(chain) {
  fs.writeFileSync(chainPath, JSON.stringify(chain, null, 2), 'utf8');
}

function mineBlock() {
  const chain = loadChain();
  const lastBlock = chain[chain.length - 1];
  const previousHash = lastBlock.hash;
  const index = lastBlock.index + 1;
  const timestamp = Date.now();

  const rewardTx = {
    from: 'SYSTEM',
    to: wallet.publicKey,
    amount: 100
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

  const newBlock = {
    index,
    timestamp,
    transactions: [rewardTx],
    previousHash,
    nonce,
    hash
  };

  chain.push(newBlock);
  saveChain(chain);

  console.log(`✅ Block #${index} mined!`);
  console.log(`🧱 Hash: ${hash}`);
  console.log(`🎁 Reward sent to: ${wallet.publicKey}`);
}

// 🔁 Loop tiap 2 menit
setInterval(() => {
  mineBlock();
}, 2 * 60 * 1000); // 2 menit

console.log('🌀 Auto miner started. Mining block setiap 2 menit...');
