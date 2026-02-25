// pool.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BAL_PATH = path.join(process.cwd(), 'balances.json');

function loadBalances() {
  try {
    if (fs.existsSync(BAL_PATH)) {
      return JSON.parse(fs.readFileSync(BAL_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️ Failed reading balances.json:', e.message);
  }
  return {};
}

function saveBalances(balances) {
  fs.writeFileSync(BAL_PATH, JSON.stringify(balances, null, 2));
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function calcPPSReward(blockReward, networkDifficulty, shareDifficulty) {
  const net = Math.pow(16, networkDifficulty);
  const share = Math.pow(16, shareDifficulty);
  return blockReward / (net / share);
}

function startsWithZeros(hash, zeros) {
  return hash.startsWith('0'.repeat(zeros));
}

module.exports = {
  loadBalances,
  saveBalances,
  sha256,
  calcPPSReward,
  startsWithZeros
};
