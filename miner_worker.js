// miner_worker.js
const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');

// Ambil data dari workerData
const { minerAddress, difficultyPrefix } = workerData;

// Mining loop di worker thread
function mineLoop() {
  const timestamp = Date.now();
  let nonce = 0;
  let hash;

  while (true) {
    hash = crypto.createHash('sha256')
      .update(minerAddress + timestamp + nonce)
      .digest('hex');

    if (nonce % 100000 === 0) {
      parentPort.postMessage({
        event: 'progress',
        miner: minerAddress,
        nonce,
        hash
      });
    }

    if (hash.startsWith(difficultyPrefix)) {
      parentPort.postMessage({
        event: 'blockFound',
        miner: minerAddress,
        nonce,
        hash,
        timestamp
      });
      break;
    }
    nonce++;
  }

  // Loop berkelanjutan: setelah block ditemukan, lanjut mining lagi
  setImmediate(mineLoop);
}

// Jalankan loop
mineLoop();
