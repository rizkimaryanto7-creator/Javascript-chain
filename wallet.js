const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');

const EXPLORER_URL = 'http://localhost:3000'; // Ganti sesuai URL explorer kamu
const WALLET_DIR = path.join(process.cwd(), 'wallets');
if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR);

/**
 * Validasi format address
 */
function isValidAddress(address) {
  return typeof address === 'string' && /^[a-f0-9]{64}$/.test(address);
}

/**
 * Generate wallet baru
 */
function generateWallet(name = 'default') {
  const privateKey = crypto.randomBytes(32).toString('hex');
  const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex');
  const wallet = {
    name,
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
    role: 'user',
    tags: [],
    plugins: [],
    isPublic: false
  };
  saveWallet(wallet);
  return wallet;
}

/**
 * Restore wallet dari private key
 */
function restoreWallet(name, privateKey) {
  if (!privateKey || privateKey.length !== 64) throw new Error('❌ Private key tidak valid');
  const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex');
  const wallet = {
    name,
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
    role: 'user',
    tags: [],
    plugins: [],
    isPublic: false
  };
  saveWallet(wallet);
  return wallet;
}

/**
 * Simpan wallet ke file
 */
function saveWallet(wallet) {
  const filePath = path.join(WALLET_DIR, `${wallet.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(wallet, null, 2), 'utf8');
}

/**
 * Load wallet dari nama
 */
function loadWallet(name = 'default') {
  const filePath = path.join(WALLET_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Wallet ${name} tidak ditemukan.`);
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Export wallet ke file backup
 */
function exportWallet(wallet) {
  const filePath = path.join(process.cwd(), `backup_${wallet.publicKey}.json`);
  fs.writeFileSync(filePath, JSON.stringify(wallet, null, 2), 'utf8');
  console.log(`📤 Wallet diexport ke ${filePath}`);
}

/**
 * Generate QR Code untuk address
 */
async function generateQRCode(address) {
  return await QRCode.toDataURL(address);
}

/**
 * Fetch balance dari explorer
 */
async function getBalance(address) {
  if (!isValidAddress(address)) return null;
  try {
    const res = await axios.get(`${EXPLORER_URL}/balance/${address}`);
    return res.data.balance;
  } catch (err) {
    console.error('❌ Gagal fetch balance:', err.message);
    return null;
  }
}

/**
 * Fetch histori transaksi dari explorer
 */
async function getTransactions(address) {
  if (!isValidAddress(address)) return [];
  try {
    const res = await axios.get(`${EXPLORER_URL}/txs?address=${address}`);
    return res.data.transactions;
  } catch (err) {
    console.error('❌ Gagal fetch transaksi:', err.message);
    return [];
  }
}

/**
 * Kirim transaksi langsung dari wallet
 */
async function sendTransaction(wallet, to, amount) {
  const tx = {
    from: wallet.publicKey,
    to,
    amount,
    timestamp: Date.now()
  };
  tx.signature = signTransaction(wallet.privateKey, tx);
  try {
    const res = await axios.post(`${EXPLORER_URL}/broadcast`, tx);
    return res.data;
  } catch (err) {
    console.error('❌ Gagal kirim transaksi:', err.message);
    return null;
  }
}

/**
 * Tanda tangan transaksi
 */
function signTransaction(privateKey, transaction) {
  const data = JSON.stringify(transaction);
  return crypto.createHash('sha256').update(data + privateKey).digest('hex');
}

/**
 * Verifikasi tanda tangan
 */
function verifySignature(publicKey, transaction, signature) {
  const expected = crypto.createHash('sha256').update(JSON.stringify(transaction) + publicKey).digest('hex');
  return expected === signature;
}

/**
 * Scripthash custom
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
 * Dokumentasi schema wallet
 */
function getWalletSchema() {
  return {
    name: 'string',
    publicKey: 'hex(64)',
    privateKey: 'hex(64)',
    createdAt: 'ISO timestamp',
    role: 'string',
    tags: ['string'],
    plugins: ['string'],
    isPublic: 'boolean'
  };
}

/**
 * CLI interface
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'generate') {
    const name = args[1] || 'default';
    const wallet = generateWallet(name);
    console.log('✅ Wallet generated:\n', wallet);

  } else if (cmd === 'restore' && args[1] && args[2]) {
    const wallet = restoreWallet(args[1], args[2]);
    console.log('✅ Wallet restored:\n', wallet);

  } else if (cmd === 'show') {
    const name = args[1] || 'default';
    const wallet = loadWallet(name);
    console.log('🔐 Current wallet:\n', wallet);

  } else if (cmd === 'info') {
    const name = args[1] || 'default';
    const wallet = loadWallet(name);
    if (!wallet) return;
    getBalance(wallet.publicKey).then(balance => {
      console.log('💰 Balance:', balance);
    });
    getTransactions(wallet.publicKey).then(txs => {
      console.log('📜 History:');
      txs.forEach(tx => {
        console.log(`- ${tx.hash} | ${tx.amount} | ${tx.timestamp}`);
      });
    });

  } else if (cmd === 'export') {
    const name = args[1] || 'default';
    const wallet = loadWallet(name);
    if (wallet) exportWallet(wallet);

  } else if (cmd === 'send' && args.length >= 4) {
    const wallet = loadWallet(args[1]);
    const to = args[2];
    const amount = parseFloat(args[3]);
    sendTransaction(wallet, to, amount).then(res => {
      console.log('📤 Transaksi dikirim:', res);
    });

  } else if (cmd === 'schema') {
    console.log('📚 Wallet Schema:\n', getWalletSchema());

  } else {
    console.log(`Usage:
  node wallet.js generate [name]
  node wallet.js restore [name] [privateKey]
  node wallet.js show [name]
  node wallet.js info [name]
  node wallet.js export [name]
  node wallet.js send [name] [to] [amount]
  node wallet.js schema`);
  }
}

module.exports = {
  generateWallet,
  restoreWallet,
  loadWallet,
  saveWallet,
  exportWallet,
  getBalance,
  getTransactions,
  sendTransaction,
  signTransaction,
  verifySignature,
  scripthash,
  isValidAddress,
  generateQRCode,
  getWalletSchema
};
