const fs = require('fs');
const admin = require('firebase-admin');
const { generateWallet } = require('./wallet');
const { broadcastBlock } = require('./network');
const Blockchain = require('./chain');

// 🔧 Load config dari file
const config = JSON.parse(fs.readFileSync('./config.json'));

// 🔐 Inisialisasi Firebase Admin SDK
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 🔐 Buat wallet penambang
const minerWallet = generateWallet();
const jsChain = new Blockchain(minerWallet.publicKey, config);
jsChain.createWallet('miner', minerWallet);

// 🔁 Load chain dari file jika ada
jsChain.loadChain();

console.log(`⛏️ Miner started`);
console.log(`🔐 Wallet:\nPublic: ${minerWallet.publicKey}`);
console.log(`💰 Initial balance: ${jsChain.getBalance(minerWallet.publicKey)}`);

// ⛏️ Mining otomatis setiap 2 menit
setInterval(async () => {
  try {
    console.log(`⛏️ Mining triggered...`);
    jsChain.minePendingTransactions('miner');

    const latestBlock = jsChain.getLatestBlock();

    // 📤 Broadcast ke peers
    await broadcastBlock(latestBlock);
    console.log(`📤 Block broadcasted to peers`);

    // 🗂️ Push ke Firestore
    await db.collection("block").add({
      height: latestBlock.height,
      hash: latestBlock.hash,
      miner: latestBlock.miner,
      timestamp: latestBlock.timestamp,
      difficulty: latestBlock.difficulty,
      nonce: latestBlock.nonce,
      previousHash: latestBlock.previousHash,
      txCount: latestBlock.transactions.length
    });

    console.log(`🗂️ Block saved to Firestore`);
    console.log(`💰 Miner balance: ${jsChain.getBalance(minerWallet.publicKey)}`);
  } catch (err) {
    console.error(`❌ Mining error: ${err.message}`);
  }
}, 2 * 60 * 1000);
