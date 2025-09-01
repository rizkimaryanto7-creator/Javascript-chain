const fs = require('fs');
const path = require('path');
const { loadWallet, signTransaction } = require('./wallet');

const wallet = loadWallet();
if (!wallet) {
  console.error('❌ Wallet belum dibuat. Jalankan: node wallet.js generate');
  process.exit(1);
}

const args = process.argv.slice(2);
const toAddress = args[0];
const amount = parseInt(args[1]);

if (!toAddress || isNaN(amount)) {
  console.log('Usage:\n  node sendTx.js <toAddress> <amount>');
  process.exit(1);
}

// 🧾 Buat transaksi
const transaction = {
  from: wallet.publicKey,
  to: toAddress,
  amount,
  timestamp: Date.now()
};

// ✍️ Tanda tangan
const signature = signTransaction(wallet.privateKey, transaction);
transaction.signature = signature;

// 📦 Simpan ke pending_tx.json
const txPath = path.join(process.cwd(), 'pending_tx.json');
let pending = [];

if (fs.existsSync(txPath)) {
  const raw = fs.readFileSync(txPath, 'utf8');
  pending = JSON.parse(raw);
}

pending.push(transaction);
fs.writeFileSync(txPath, JSON.stringify(pending, null, 2), 'utf8');

console.log('✅ Transaksi berhasil dibuat dan disimpan ke pending_tx.json');
console.log(transaction);
