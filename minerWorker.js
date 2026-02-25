const { parentPort, workerData } = require('worker_threads');
const axios = require('axios');
const crypto = require('crypto');

const CORE_ID = workerData.core;
const NODE_URL = workerData.nodeUrl;
const MINER_ADDRESS = workerData.minerAddress;

async function mineLoop() {
  try {
    // 1. Ambil tugas mining
    const taskRes = await axios.get(`${NODE_URL}/mining-task`);
    const task = taskRes.data;

    if (!task) {
      setTimeout(mineLoop, 2000);
      return;
    }

    const {
      index,
      previousHash,
      timestamp,
      transactions = [],
      startNonce,
      endNonce,
      difficulty
    } = task;

    // Pastikan difficulty dalam format string '000...'
    let targetPrefix = typeof difficulty === 'string' ? difficulty : '0'.repeat(difficulty || 2);

    let nonce = typeof startNonce === 'number' ? startNonce : 0;
    const maxNonce = typeof endNonce === 'number' ? endNonce : nonce + 1000000;

    // Stringify transaksi sekali saja di luar loop untuk performa
    const txString = JSON.stringify(transactions);

    while (nonce < maxNonce) {
      // RAKIT DATA (Urutan harus SAMA PERSIS dengan server)
      const hashInput = String(index) + String(previousHash) + String(timestamp) + txString + String(nonce);

      const hash = crypto.createHash('sha256')
        .update(hashInput)
        .digest('hex');

      // Update progress ke parent setiap 50.000 nonce
      if (nonce % 50000 === 0) {
        parentPort.postMessage({
          core: CORE_ID,
          hashrate: 50000, // Ini lebih akurat sebagai delta
          bestHash: hash
        });
      }

      // Jika Hash Valid
      if (hash.startsWith(targetPrefix)) {
        try {
          await axios.post(`${NODE_URL}/submit-block`, {
            index,
            previousHash,
            transactions,
            nonce,
            hash,
            minerAddress: MINER_ADDRESS,
            timestamp
          });

          parentPort.postMessage({
            core: CORE_ID,
            found: true,
            hash
          });
          break; // Keluar dari while untuk ambil task baru
        } catch (postError) {
          // Jika kena 429 atau error lain saat submit
          parentPort.postMessage({ core: CORE_ID, error: `Submit error: ${postError.message}` });
          break;
        }
      }
      nonce++;
    }

    setImmediate(mineLoop);
  } catch (e) {
    parentPort.postMessage({ core: CORE_ID, error: `Fetch error: ${e.message}` });
    setTimeout(mineLoop, 2000);
  }
}

mineLoop();
