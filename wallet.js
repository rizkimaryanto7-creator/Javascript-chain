const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Membuat wallet baru
 * Private key: random 32 byte → hex
 * Public key : SHA-256 dari private key (bukan ECC)
 */
function generateWallet() {
  const privateKey = crypto.randomBytes(32).toString('hex');
  const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex');
  const wallet = { publicKey, privateKey };
  saveWallet(wallet);
  return wallet;
}

/**
 * Restore wallet dari private key
 */
function restoreWallet(privateKey) {
  const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex');
  const wallet = { publicKey, privateKey };
  saveWallet(wallet);
  return wallet;
}

/**
 * Simpan wallet ke wallet.json
 */
function saveWallet(wallet) {
  const filePath = path.join(process.cwd(), 'wallet.json');
  fs.writeFileSync(filePath, JSON.stringify(wallet, null, 2), 'utf8');
}

/**
 * Load wallet dari wallet.json
 */
function loadWallet() {
  const filePath = path.join(process.cwd(), 'wallet.json');
  if (!fs.existsSync(filePath)) {
    console.warn('⚠️ wallet.json tidak ditemukan. Generate dulu.');
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Scripthash custom
 * - Gabungan input + nonce
 * - Loop hashing 16x
 * - Tiap kelipatan ke-3: ganti huruf vokal → 'x'
 * - Reverse string di tiap iterasi
 */
function scripthash(input, nonce) {
  let data = input + nonce;
  for (let i = 0; i < 16; i++) {
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    data = hash.split('').reverse().join('');
    if (i % 3 === 0) {
      data = data.replace(/[aeiou]/gi, 'x');
    }
  }
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Tanda tangan transaksi
 * - SHA-256 dari JSON.stringify(transaction) + privateKey
 */
function signTransaction(privateKey, transaction) {
  const data = JSON.stringify(transaction);
  return crypto.createHash('sha256').update(data + privateKey).digest('hex');
}

/**
 * Verifikasi tanda tangan
 * - SHA-256 dari JSON.stringify(transaction) + publicKey === signature
 */
function verifySignature(publicKey, transaction, signature) {
  const expected = crypto.createHash('sha256').update(JSON.stringify(transaction) + publicKey).digest('hex');
  return expected === signature;
}

/**
 * CLI interface
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'generate') {
    const wallet = generateWallet();
    console.log('✅ Wallet generated:\n', wallet);
  } else if (args[0] === 'restore' && args[1]) {
    const wallet = restoreWallet(args[1]);
    console.log('✅ Wallet restored:\n', wallet);
  } else if (args[0] === 'show') {
    const wallet = loadWallet();
    console.log('🔐 Current wallet:\n', wallet);
  } else {
    console.log('Usage:\n  node wallet.js generate\n  node wallet.js restore <privateKey>\n  node wallet.js show');
  }
}

module.exports = {
  generateWallet,
  restoreWallet,
  loadWallet,
  saveWallet,
  scripthash,
  signTransaction,
  verifySignature
};
