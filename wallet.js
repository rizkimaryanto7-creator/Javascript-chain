const crypto = require('crypto');

/**
 * Membuat wallet baru
 * Private key: random 32 byte → hex
 * Public key : SHA-256 dari private key (bukan ECC)
 */
function generateWallet() {
  const privateKey = crypto.randomBytes(32).toString('hex');
  const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex');
  return { publicKey, privateKey };
}

/**
 * Fungsi scripthash custom
 * - Gabungan input + nonce
 * - Loop hashing 16x
 * - Tiap kelipatan ke-3: ganti huruf vokal → 'x'
 * - Reverse string di tiap iterasi
 * - Output: SHA-256 terakhir dalam hex
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
 * - Bukan ECC, cuma SHA-256(transaction + privateKey)
 */
function signTransaction(privateKey, transaction) {
  const data = JSON.stringify(transaction);
  return crypto.createHash('sha256').update(data + privateKey).digest('hex');
}

/**
 * Verifikasi tanda tangan
 * - Cek apakah hash(transaction + publicKey) === signature
 */
function verifySignature(publicKey, transaction, signature) {
  const expected = crypto.createHash('sha256').update(JSON.stringify(transaction) + publicKey).digest('hex');
  return expected === signature;
}

module.exports = {
  generateWallet,
  scripthash,
  signTransaction,
  verifySignature
};
