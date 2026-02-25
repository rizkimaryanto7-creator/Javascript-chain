const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { keccak256 } = require('js-sha3'); // pakai js-sha3 untuk keccak256

// Lokasi file penyimpanan wallet
const WALLET_FILE = path.join(process.cwd(), 'wallets.json');

// Utility: load semua wallet dari file
function loadAllWallets() {
  if (!fs.existsSync(WALLET_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  } catch (e) {
    console.error("⚠️ Failed to read wallets.json:", e.message);
    return {};
  }
}

// Utility: simpan semua wallet ke file
function saveAllWallets(wallets) {
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
}

// Utility: generate Ethereum-style address dari public key
function generateEthereumAddress(publicKeyBuffer) {
  // Hash pakai keccak256 dari js-sha3
  const hash = keccak256(publicKeyBuffer);
  // Ambil 20 byte terakhir (40 hex chars)
  const address = '0x' + hash.slice(-40);
  return address.toLowerCase();
}

// Generate wallet baru untuk user
function generateEthereumWalletForUser(username, name) {
  const wallets = loadAllWallets();

  if (!wallets[username]) wallets[username] = {};

  // Generate keypair ECDSA secp256k1
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });

  const address = generateEthereumAddress(publicKey);

  const wallet = {
    name,
    privateKey: privateKey.toString('hex'),
    publicKey: publicKey.toString('hex'),
    address
  };

  wallets[username][name] = wallet;
  saveAllWallets(wallets);

  return wallet;
}

// Ambil semua wallet milik user
function getAllForUser(username) {
  const wallets = loadAllWallets();
  return wallets[username] ? Object.values(wallets[username]) : [];
}

// Ambil semua wallet (global)
function getAll() {
  const wallets = loadAllWallets();
  return Object.values(wallets).flatMap(userWallets => Object.values(userWallets));
}

// Simpan wallet import untuk user
function saveWalletForUser(username, name, walletObj) {
  const wallets = loadAllWallets();
  if (!wallets[username]) wallets[username] = {};
  wallets[username][name] = walletObj;
  saveAllWallets(wallets);
}

// Load wallet tertentu milik user
function loadWalletForUser(username, name) {
  const wallets = loadAllWallets();
  if (!wallets[username]) return null;
  return wallets[username][name] || null;
}

// Hapus wallet milik user
function deleteWalletForUser(username, name) {
  const wallets = loadAllWallets();
  if (!wallets[username]) return;
  delete wallets[username][name];
  saveAllWallets(wallets);
}

module.exports = {
  generateEthereumWalletForUser,
  getAllForUser,
  getAll,
  saveWalletForUser,
  loadWalletForUser,
  deleteWalletForUser
};
