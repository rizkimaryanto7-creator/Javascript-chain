const axios = require('axios');

const peers = [
  'http://localhost:3000',
  'http://localhost:3001',
  // Tambahkan node lain di sini
];

async function broadcastBlock(block) {
  for (const peer of peers) {
    try {
      await axios.post(`${peer}/block`, block);
      console.log(`📤 Block sent to ${peer}`);
    } catch (err) {
      console.log(`⚠️ Failed to send to ${peer}: ${err.message}`);
    }
  }
}

// ✅ Tambahkan broadcastChain untuk sinkronisasi
async function broadcastChain(chain) {
  for (const peer of peers) {
    try {
      await axios.post(`${peer}/sync`, { chain });
      console.log(`🔄 Chain sent to ${peer}`);
    } catch (err) {
      console.log(`⚠️ Failed to sync with ${peer}: ${err.message}`);
    }
  }
}

module.exports = {
  broadcastBlock,
  broadcastChain
};
