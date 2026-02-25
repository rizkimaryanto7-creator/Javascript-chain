const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Variabel ini akan diupdate oleh server.js lewat metode setDifficulty
let difficultyPrefix = '00'; 

class Blockchain {
  constructor(minerAddress, config) {
    this.chainPath = path.join(process.cwd(), 'chain.json');
    this.config = config;
    this.minerAddress = minerAddress;
    this.pendingTransactions = [];
  }

  // ================= SETTER DIFFICULTY =================
  // Dipanggil dari server.js agar chain.js tahu prefix terbaru
  setDifficulty(prefix) {
    difficultyPrefix = prefix;
  }

  // ================= HASH FUNCTION (SINKRON) =================
  calculateHash(index, previousHash, timestamp, transactions, nonce) {
    // Pastikan transaksi selalu di-stringify dengan format yang sama
    const txData = JSON.stringify(transactions);
    
    // Menggunakan Template Literals untuk memastikan tidak ada spasi liar
    const data = `${index}${previousHash}${timestamp}${txData}${nonce}`;
    
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // ================= LOAD CHAIN =================
  loadChain() {
    try {
      if (fs.existsSync(this.chainPath)) {
        const data = fs.readFileSync(this.chainPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error("⚠️ Error loading chain.json, using Genesis:", e.message);
    }
    
    const genesis = this.createGenesisBlock();
    this.saveChain([genesis]);
    return [genesis];
  }

  get chain() {
    return this.loadChain();
  }

  saveChain(chain) {
    try {
      fs.writeFileSync(this.chainPath, JSON.stringify(chain, null, 2));
    } catch (e) {
      console.error("❌ Failed to save chain.json:", e.message);
    }
  }

  // ================= GENESIS =================
  createGenesisBlock() {
  const premineAmount = Math.floor(this.config.totalSupply * this.config.premineRatio);
  const premineTx = {
    from: "SYSTEM",
    to: this.config.premineAddress,
    amount: premineAmount,
    timestamp: 1700000000000 // fixed timestamp biar konsisten
  };

  return {
    index: 0,
    timestamp: 1700000000000,
    transactions: [premineTx],
    previousHash: "0",
    nonce: 0,
    hash: "GENESIS_BLOCK_DATA"
  };
}

  getLatestBlock() {
    const chain = this.loadChain();
    return chain[chain.length - 1];
  }

  getCurrentReward() {
    return this.config.baseReward || 100;
  }

  // ================= ADD BLOCK =================
  addBlockFromWorker(transactions, nonce, hash, minerAddress, timestamp) {
    const chain = this.loadChain();
    const latestBlock = chain[chain.length - 1];

    // Jika transaksi datang dalam bentuk string, parse dulu
    const txs = typeof transactions === "string" ? JSON.parse(transactions) : transactions;

    const newBlock = {
      index: chain.length,
      timestamp: Number(timestamp),
      transactions: txs,
      previousHash: latestBlock.hash,
      nonce: Number(nonce),
      hash: hash
    };

    // Verifikasi ulang hash sebelum disimpan
    const recalculatedHash = this.calculateHash(
      newBlock.index,
      newBlock.previousHash,
      newBlock.timestamp,
      newBlock.transactions,
      newBlock.nonce
    );

    if (recalculatedHash !== hash) {
      console.error("❌ Invalid block hash! (Mismatch)");
      console.log(`Diterima: ${hash}`);
      console.log(`Dihitung: ${recalculatedHash}`);
      return false;
    }

    // Validasi difficulty
    if (!hash.startsWith(difficultyPrefix)) {
      console.error(`❌ Block does not meet difficulty! Need: ${difficultyPrefix}`);
      return false;
    }

    chain.push(newBlock);
    this.pendingTransactions = []; // Bersihkan pool transaksi
    this.saveChain(chain);
    
    console.log(`⛓ Block #${newBlock.index} added successfully by ${minerAddress}`);
    return true;
  }

  // ================= WORK TX =================
  buildWorkTransactions(minerAddress) {
    const rewardTx = {
      from: "SYSTEM",
      to: minerAddress,
      amount: this.getCurrentReward(),
      timestamp: Date.now() // Tambahkan timestamp unik agar hash beda tiap percobaan
    };
    return [rewardTx, ...this.pendingTransactions];
  }

  // ================= BALANCE =================
  getBalance(address) {
    const chain = this.loadChain();
    let balance = 0;
    for (const block of chain) {
      for (const tx of block.transactions) {
        if (tx.to === address) balance += tx.amount;
        if (tx.from === address) balance -= tx.amount;
      }
    }
    return balance;
  }

  // ================= TRANSACTION LOOKUP =================
  getTransactionsByWallet(address) {
    const chain = this.loadChain();
    const txs = [];
    chain.forEach((block, idx) => {
      block.transactions.forEach(tx => {
        if (tx.to === address || tx.from === address) {
          txs.push({ ...tx, blockIndex: idx });
        }
      });
    });
    return txs;
  }

  getTransactionByHash(hash) {
    const chain = this.loadChain();
    for (let i = 0; i < chain.length; i++) {
      const block = chain[i];
      for (const tx of block.transactions) {
        const txHash = crypto.createHash('sha256')
          .update(JSON.stringify(tx))
          .digest('hex');
        if (txHash === hash) return { blockIndex: i, tx };
      }
    }
    return null;
  }

  // ================= CREATE TX =================
  createTransaction(wallet, toAddress, amount) {
    if (amount <= 0) throw new Error("Invalid amount");
    if (this.getBalance(wallet.publicKey) < amount) throw new Error("Insufficient balance");

    const tx = {
      from: wallet.publicKey,
      to: toAddress,
      amount: Number(amount),
      timestamp: Date.now(),
      hash: "" // Akan diisi di node/wallet
    };

    this.pendingTransactions.push(tx);
    return tx;
  }

  // ================= VALIDATE FULL CHAIN =================
  isChainValid() {
    const chain = this.loadChain();
    for (let i = 1; i < chain.length; i++) {
      const current = chain[i];
      const previous = chain[i - 1];

      const recalculatedHash = this.calculateHash(
        current.index,
        current.previousHash,
        current.timestamp,
        current.transactions,
        current.nonce
      );

      if (current.hash !== recalculatedHash) return false;
      if (current.previousHash !== previous.hash) return false;
    }
    return true;
  }
}

module.exports = Blockchain;
