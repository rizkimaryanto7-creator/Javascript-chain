const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let USE_EC = true, ec;
try {
  const EC = require('elliptic').ec;
  ec = new EC('secp256k1');
} catch (e) {
  USE_EC = false;
  console.warn('⚠️ elliptic not installed. Using HMAC fallback.');
}

function signTransaction(privateKeyHex, data) {
  const payload = JSON.stringify(data);
  if (USE_EC) {
    const key = ec.keyFromPrivate(privateKeyHex, 'hex');
    const hash = crypto.createHash('sha256').update(payload).digest();
    return key.sign(hash).toDER('hex');
  } else {
    return crypto.createHmac('sha256', privateKeyHex).update(payload).digest('hex');
  }
}

function verifySignature(publicKeyHex, data, signatureHex) {
  if (data.from === 'SYSTEM') return true;
  const payload = JSON.stringify(data);
  if (USE_EC) {
    try {
      const key = ec.keyFromPublic(publicKeyHex, 'hex');
      const hash = crypto.createHash('sha256').update(payload).digest();
      return key.verify(hash, signatureHex);
    } catch {
      return false;
    }
  } else {
    const check = crypto.createHmac('sha256', publicKeyHex).update(payload).digest('hex');
    return check === signatureHex;
  }
}

class Block {
  constructor(index, timestamp, transactions, previousHash, nonce = 0) {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = nonce;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto.createHash('sha256')
      .update(this.previousHash + JSON.stringify(this.transactions) + this.nonce)
      .digest('hex');
  }

  mineBlock(difficulty) {
    const prefix = '0'.repeat(difficulty);
    while (!this.hash.startsWith(prefix)) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
  }
}

class Blockchain {
  constructor(devPublicKey, config) {
    this.difficulty = config.difficulty;
    this.totalSupply = config.totalSupply;
    this.premine = Math.floor(config.premineRatio * this.totalSupply);
    this.baseReward = config.baseReward;
    this.minReward = config.minReward;
    this.halvingIntervalBlocks = config.halvingIntervalBlocks;

    this.chain = [this.createGenesisBlock(devPublicKey)];
    this.pendingTransactions = [];
    this.wallets = {};
    this.minedCoins = this.premine;

    this.loadChain();
  }

  createGenesisBlock(devPublicKey) {
    const txs = [{ from: 'SYSTEM', to: devPublicKey, amount: this.premine }];
    const b = new Block(0, Date.now(), txs, '0'.repeat(64), 0);
    b.hash = b.calculateHash();
    return b;
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  getCurrentReward(height = this.chain.length) {
    const halvings = Math.floor(height / this.halvingIntervalBlocks);
    const reward = this.baseReward / Math.pow(2, halvings);
    return reward >= this.minReward ? reward : this.minReward;
  }

  createWallet(name, walletObj) {
    this.wallets[name] = walletObj;
  }

  getBalance(publicKey) {
    let balance = 0;
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.to === publicKey) balance += tx.amount;
        if (tx.from === publicKey) balance -= tx.amount;
      }
    }
    return balance;
  }

  getTransactionsByWallet(publicKey) {
    const txs = [];
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === publicKey || tx.to === publicKey) {
          txs.push({
            blockIndex: block.index,
            from: tx.from,
            to: tx.to,
            amount: tx.amount,
            timestamp: block.timestamp
          });
        }
      }
    }
    return txs;
  }

  createTransaction(fromName, toPublicKey, amount) {
    const sender = this.wallets[fromName];
    if (!sender || amount <= 0 || this.getBalance(sender.publicKey) < amount) return;
    const payload = { from: sender.publicKey, to: toPublicKey, amount };
    payload.signature = signTransaction(sender.privateKey, payload);
    this.pendingTransactions.push(payload);
  }

  buildWorkTransactions(minerAddress) {
    const validTxs = [];
    for (const tx of this.pendingTransactions) {
      if (tx.from === 'SYSTEM' || verifySignature(tx.from, { from: tx.from, to: tx.to, amount: tx.amount }, tx.signature)) {
        validTxs.push(tx);
      }
    }
    const reward = this.getCurrentReward(this.chain.length);
    if (this.minedCoins + reward > this.totalSupply) return null;
    validTxs.push({ from: 'SYSTEM', to: minerAddress, amount: reward });
    return validTxs;
  }

  addBlockFromWorker(transactions, nonce, hash, minerAddress) {
    const prev = this.getLatestBlock();
    const expectedHash = crypto.createHash('sha256')
      .update(prev.hash + JSON.stringify(transactions) + nonce)
      .digest('hex');
    const prefix = '0'.repeat(this.difficulty);
    if (hash !== expectedHash || !hash.startsWith(prefix)) return false;

    const rewardTx = transactions[transactions.length - 1];
    if (!rewardTx || rewardTx.from !== 'SYSTEM' || rewardTx.to !== minerAddress) return false;
    if (rewardTx.amount !== this.getCurrentReward(this.chain.length)) return false;
    if (this.minedCoins + rewardTx.amount > this.totalSupply) return false;

    for (const tx of transactions) {
      if (tx.from !== 'SYSTEM' && !verifySignature(tx.from, { from: tx.from, to: tx.to, amount: tx.amount }, tx.signature)) {
        return false;
      }
    }

    const newBlock = new Block(this.chain.length, Date.now(), transactions, prev.hash, nonce);
    newBlock.hash = expectedHash;
    this.chain.push(newBlock);
    this.minedCoins += rewardTx.amount;
    this.pendingTransactions = [];
    return true;
  }

  minePendingTransactions(minerName) {
    const minerWallet = this.wallets[minerName];
    if (!minerWallet) return;
    const workTxs = this.buildWorkTransactions(minerWallet.publicKey);
    if (!workTxs) return;
    const block = new Block(this.chain.length, Date.now(), workTxs, this.getLatestBlock().hash);
    block.mineBlock(this.difficulty);
    const ok = this.addBlockFromWorker(workTxs, block.nonce, block.hash, minerWallet.publicKey);
    return ok;
  }

  getTransactionByHash(hash) {
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        const txHash = crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex');
        if (txHash === hash) return { blockIndex: block.index, tx };
      }
    }
    return null;
  }

  loadChain() {
    const p = path.join(process.cwd(), 'chain.json');
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
          this.chain = data.map(b => Object.assign(new Block(), b));
          for (let i = 0; i < this.chain.length; i++) {
            const blk = this.chain[i];
            const calc = crypto.createHash('sha256')
              .update(blk.previousHash + JSON.stringify(blk.transactions) + blk.nonce)
              .digest('hex');
            if (blk.hash !== calc) throw new Error(`Hash mismatch at block ${i}`);
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ Failed to load chain.json:', e.message);
      this.chain = [this.chain[0]];
    }
  }
}

module.exports = Blockchain;
