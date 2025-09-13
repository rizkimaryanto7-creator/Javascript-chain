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

// 🧠 Fungsi mining modular
async function performMining() {
  try {
    const pendingTx = jsChain.getPendingTransactions();
    console.log(`📥 Pending transactions: ${pendingTx.length}`);

    if (pendingTx.length === 0) {
      console.log(`⏸️ No transactions to mine. Skipping...`);
      return;
    }

    console.log(`⛏️ Mining started...`);
    const minedBlock = jsChain.minePendingTransactions('miner');

    if (!minedBlock || minedBlock.transactions.length === 0) {
      console.log(`⚠️ No transactions were mined. Possibly skipped due to validation.`);
      return;
    }

    console.log(`✅ Block mined: #${minedBlock.height} | TX count: ${minedBlock.transactions.length}`);

    // 📤 Broadcast ke peers
    await broadcastBlock(minedBlock);
    console.log(`📡 Block broadcasted to peers`);

    // 🗂️ Simpan ke Firestore
    await db.collection("block").add({
      height: minedBlock.height,
      hash: minedBlock.hash,
      miner: minedBlock.miner,
      timestamp: minedBlock.timestamp,
      difficulty: minedBlock.difficulty,
      nonce: minedBlock.nonce,
      previousHash: minedBlock.previousHash,
      txCount: minedBlock.transactions.length
    });

    console.log(`🗂️ Block saved to Firestore`);
    console.log(`💰 Miner balance: ${jsChain.getBalance(minerWallet.publicKey)}`);

    // 🔄 Cek transaksi yang belum diproses
    const remainingTx = jsChain.getPendingTransactions();
    if (remainingTx.length > 0) {
      console.log(`🔁 Remaining transactions: ${remainingTx.length}. Will retry in next cycle.`);
    }
  } catch (err) {
    console.error(`❌ Mining error: ${err.message}`);
  }
}

// ⏱️ Trigger mining setiap 2 menit
setInterval(performMining, 2 * 60 * 1000);
