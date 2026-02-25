const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
const { ec: EC } = require('elliptic');
const { keccak256 } = require('js-sha3');   // Tambahan untuk Ethereum-style address

const ec = new EC('secp256k1');

const EXPLORER_URL = 'http://localhost:3000';
const WALLET_DIR = path.join(process.cwd(), 'wallets');
if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR);

const ENC_KEY = crypto.createHash('sha256').update('your-password').digest();

// --- Encryption Helpers ---
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decrypt(encText) {
  if (!encText.includes(':')) return encText;
  const [ivHex, data] = encText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, iv);
  let dec = decipher.update(data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

// --- Wallet Class ---
class Wallet {
  constructor(name, keyPair) {
    this.name = name;
    this.keyPair = keyPair;
    this.publicKey = keyPair.getPublic('hex');
    this.privateKey = keyPair.getPrivate('hex');

    // Ethereum-style address: keccak256(publicKey) → ambil 20 byte terakhir
    const pubKeyNoPrefix = this.publicKey.startsWith('04') ? this.publicKey.slice(2) : this.publicKey;
    const hash = keccak256(Buffer.from(pubKeyNoPrefix, 'hex'));
    this.address = '0x' + hash.slice(-40);
  }

  sign(tx) {
    const hash = crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex');
    return this.keyPair.sign(hash).toDER('hex');
  }
}

// --- Nonce Tracking ---
const walletNonces = {};
function getNonce(address) {
  return walletNonces[address] || 0;
}
function incrementNonce(address) {
  walletNonces[address] = getNonce(address) + 1;
}

// --- Wallet Persistence ---
function saveWallet(wallet) {
  const filePath = path.join(WALLET_DIR, `${wallet.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    name: wallet.name,
    publicKey: wallet.publicKey,
    privateKey: encrypt(wallet.privateKey),
    address: wallet.address,
    createdAt: new Date().toISOString(),
    role: 'user'
  }, null, 2));
}

function generateWallet(name = 'default') {
  const keyPair = ec.genKeyPair();
  const wallet = new Wallet(name, keyPair);
  walletNonces[wallet.address] = 0;
  saveWallet(wallet);
  return wallet;
}

function restoreWallet(name, privateKey) {
  const keyPair = ec.keyFromPrivate(privateKey, 'hex');
  const wallet = new Wallet(name, keyPair);
  walletNonces[wallet.address] = 0;
  saveWallet(wallet);
  return wallet;
}

function loadWallet(name = 'default') {
  const filePath = path.join(WALLET_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const priv = decrypt(raw.privateKey);
  const keyPair = ec.keyFromPrivate(priv, 'hex');
  const wallet = new Wallet(raw.name, keyPair);
  walletNonces[wallet.address] = walletNonces[wallet.address] || 0;
  return wallet;
}

function getAll() {
  const files = fs.readdirSync(WALLET_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(WALLET_DIR, f), 'utf8'));
    return { name: raw.name, publicKey: raw.publicKey, address: raw.address, createdAt: raw.createdAt, role: raw.role };
  });
}

// --- Transaction Helpers ---
function signTransaction(wallet, to, amount) {
  const nonce = getNonce(wallet.address);
  const tx = { from: wallet.address, to, amount, nonce, timestamp: Date.now() };
  const signature = wallet.sign(tx);
  incrementNonce(wallet.address);
  return { ...tx, signature };
}

function verifySignature(publicKey, signature, tx) {
  const key = ec.keyFromPublic(publicKey, 'hex');
  const hash = crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex');
  return key.verify(hash, signature);
}

// --- Explorer Integration ---
async function getBalance(address) {
  try {
    const res = await axios.get(`${EXPLORER_URL}/api/address/${address}`);
    return res.data.balance || 0;
  } catch {
    return null;
  }
}

async function getTransactions(address) {
  try {
    const res = await axios.get(`${EXPLORER_URL}/api/history/${address}`);
    return res.data.transactions || [];
  } catch {
    return [];
  }
}

async function sendTransaction(walletName, toAddress, amount) {
  try {
    const wallet = loadWallet(walletName);
    if (!wallet) throw new Error("Wallet not found");
    const tx = signTransaction(wallet, toAddress, amount);
    const res = await axios.post(`${EXPLORER_URL}/api/transfer`, tx);
    return res.data;
  } catch (err) {
    console.error('❌ Gagal kirim transaksi:', err.message);
    return null;
  }
}

async function generateQRCode(address) {
  return await QRCode.toDataURL(address);
}

module.exports = {
  generateWallet,
  restoreWallet,
  loadWallet,
  saveWallet,
  getAll,
  getBalance,
  getTransactions,
  sendTransaction,
  generateQRCode,
  signTransaction,
  verifySignature,
  getNonce
};
