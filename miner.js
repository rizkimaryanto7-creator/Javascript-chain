const Blockchain = require('./chain');
const { generateWallet } = require('./wallet');
const { broadcastBlock } = require('./network');

// 🔐 Buat wallet miner
const minerWallet = generateWallet();
const jsChain = new Blockchain(minerWallet.publicKey);
jsChain.createWallet('miner', minerWallet);

// 🔁 Load chain dari file jika ada
jsChain.loadChain();

console.log(`⛏️ Miner started`);
console.log(`🔐 Wallet:\nPublic: ${minerWallet.publicKey}\nPrivate: ${minerWallet.privateKey}`);
console.log(`💰 Initial balance: ${jsChain.getBalance(minerWallet.publicKey)}`);

// ⛏️ Mining otomatis setiap 2 menit
setInterval(async () => {
  try {
    console.log(`⛏️ Mining triggered...`);
    jsChain.minePendingTransactions('miner');

    const latestBlock = jsChain.getLatestBlock();
    await broadcastBlock(latestBlock);

    console.log(`📤 Block broadcasted to peers`);
    console.log(`💰 Miner balance: ${jsChain.getBalance(minerWallet.publicKey)}`);
  } catch (err) {
    console.error(`❌ Mining error: ${err.message}`);
  }
}, 2 * 60 * 1000);
