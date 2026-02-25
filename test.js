const { generateWallet } = require('./wallet.js');

const w = generateWallet('test');
console.log("Public Key:", w.publicKey);
console.log("Ethereum Address:", w.address);
