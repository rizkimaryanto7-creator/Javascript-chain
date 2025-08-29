const crypto = require('crypto');
const { scripthash } = require('./wallet');

class Block {
  constructor(index, timestamp, transactions, previousHash = '', nonce = 0) {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = nonce;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return scripthash(
      this.index + this.timestamp + JSON.stringify(this.transactions) + this.previousHash,
      this.nonce
    );
  }

  mineBlock(difficulty) {
    while (!this.hash.startsWith('0'.repeat(difficulty))) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
    console.log(`✅ Block mined: ${this.hash}`);
  }
}

module.exports = Block;
