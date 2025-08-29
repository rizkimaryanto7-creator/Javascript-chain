const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');

let { core, blockData, difficulty, minerAddress } = workerData;
let nonce = 0;
let hashes = 0;
let bestHash = 'f'.repeat(64);
let lastReport = Date.now();
let mining = true;
const targetPrefix = '0'.repeat(difficulty);

function calculateHash(data, nonce) {
  return crypto.createHash('sha256').update(data + nonce).digest('hex');
}

function loop() {
  if (!mining) return;
  const hash = calculateHash(blockData, nonce);
  hashes++;

  if (hash < bestHash) bestHash = hash;

  if (hash.startsWith(targetPrefix)) {
    parentPort.postMessage({
      found: true,
      core,
      nonce,
      hash,
      minerAddress,
      bestHash
    });
    mining = false;
    return;
  }

  nonce++;
  const now = Date.now();
  if (now - lastReport >= 1000) {
    const hashrate = Math.floor(hashes / ((now - lastReport) / 1000));
    parentPort.postMessage({
      found: false,
      core,
      hashrate,
      bestHash
    });
    hashes = 0;
    lastReport = now;
  }

  setImmediate(loop);
}

parentPort.on('message', (msg) => {
  if (msg.cmd === 'stop') mining = false;
  if (msg.cmd === 'update') {
    blockData = msg.blockData;
    difficulty = msg.difficulty;
    nonce = 0;
    bestHash = 'f'.repeat(64);
    mining = true;
    loop();
  }
});

loop();
