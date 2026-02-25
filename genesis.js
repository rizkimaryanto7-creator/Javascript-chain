const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { loadWallet } = require('./wallet');

const wallet = loadWallet();
if (!wallet) {
  console.error('❌ Wallet belum dibuat. Jalankan: node wallet.js generate');
  process.exit(1);
}

const chainPath = path.join(process.cwd(), 'chain.json');

function calculateHash(block) {
  const data =
    block.index +
    block.previousHash +
    block.timestamp +
    JSON.stringify(block.transactions) +
    block.nonce +
    block.difficulty;

  return crypto.createHash('sha256').update(data).digest('hex');
}

const genesisTx = {
  from: "SYSTEM",
  to: wallet.publicKey,
  amount: 500
};

const genesisBlock = {
  index: 0,
  timestamp: Date.now(),
  transactions: [genesisTx],
  previousHash: "0",
  difficulty: 3,
  nonce: 0
};

genesisBlock.hash = calculateHash(genesisBlock);

fs.writeFileSync(chainPath, JSON.stringify([genesisBlock], null, 2));

console.log("✅ Genesis block created!");
console.log("🧱 Hash:", genesisBlock.hash);
