// =======================
// JS-Chain Miner Frontend
// =======================

let chart;
let labels = [], totalHashrateHistory = [], blocksFoundHistory = [], rewardsHistory = [];
const cubeContainer = document.getElementById('cubeContainer');
const hammer = document.getElementById('hammer');
let mining = false;

// Render 100 kubus untuk animasi mining
for (let i = 0; i < 100; i++) {
  const div = document.createElement('div');
  div.className = 'cube';
  cubeContainer.appendChild(div);
}
const cubes = document.querySelectorAll('.cube');

// =======================
// Fetch Stats dari Backend
// =======================
async function fetchStats() {
  try {
    const res = await fetch('/miner-stats');
    const data = await res.json();

    // Update status global
    document.getElementById('height').textContent = data.height || 0;
    document.getElementById('difficulty').textContent = data.difficulty || '0000';
    document.getElementById('reward').textContent = data.totalShares || 0;
    document.getElementById('blocksMined').textContent = data.minerCount || 0;
    document.getElementById('uptime').textContent = Math.floor(performance.now() / 1000);
    document.getElementById('totalHashrate').textContent = data.totalHashrate || 0;

    // Status badge
    const isMining = mining;
    document.getElementById('statusBadge').textContent = isMining ? 'Mining' : 'Idle';
    document.getElementById('statusBadge').className = `badge ${isMining ? 'bg-success' : 'bg-secondary'}`;

    // Update chart data
    labels.push(new Date().toLocaleTimeString());
    totalHashrateHistory.push(data.totalHashrate || 0);
    blocksFoundHistory.push(data.minerCount || 0);
    rewardsHistory.push(data.totalShares || 0);

    if (labels.length > 20) {
      labels.shift();
      totalHashrateHistory.shift();
      blocksFoundHistory.shift();
      rewardsHistory.shift();
    }

    chart.data.labels = labels;
    chart.data.datasets[0].data = totalHashrateHistory;
    chart.data.datasets[1].data = blocksFoundHistory;
    chart.data.datasets[2].data = rewardsHistory;
    chart.update();

    // Update tabel per-core
    const tbody = document.querySelector('#coreTable tbody');
    tbody.innerHTML = '';
    let fastestCore = null, maxRate = 0;
    if (data.perCore) {
      for (const core in data.perCore) {
        if (data.perCore[core] > maxRate) {
          maxRate = data.perCore[core];
          fastestCore = core;
        }
      }
      for (const core in data.perCore) {
        const tr = document.createElement('tr');
        if (core == fastestCore && data.totalHashrate > 0) tr.classList.add('core-fastest');
        tr.innerHTML = `<td>${core}</td><td>${data.perCore[core] || 0}</td><td class="hash">${data.bestHash?.[core] || '-'}</td>`;
        tbody.appendChild(tr);
      }
    }
  } catch (err) {
    console.error('❌ Error fetchStats:', err);
  }
}

// =======================
// Notifikasi + Log
// =======================
function showNotification(msg) {
  const notif = document.createElement('div');
  notif.className = 'toast align-items-center text-bg-success border-0 show';
  notif.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div>
    <button type="button" class="btn-close btn-close-dark me-2 m-auto" onclick="this.parentElement.parentElement.remove()"></button></div>`;
  document.getElementById('notifications').appendChild(notif);

  const li = document.createElement('li');
  li.className = 'list-group-item';
  li.textContent = msg;
  document.getElementById('logList').appendChild(li);
}

// =======================
// Animasi Palu
// =======================
function moveHammerToCube(cube) {
  const rect = cube.getBoundingClientRect();
  const parentRect = cubeContainer.getBoundingClientRect();
  hammer.style.left = (rect.left - parentRect.left) + "px";
  hammer.style.top = (rect.top - parentRect.top - 30) + "px";
  hammer.classList.add('hit');
  setTimeout(() => hammer.classList.remove('hit'), 200);
}

// =======================
// Fungsi Mining
// =======================
async function startMining() {
  mining = true;
  const pubKey = document.getElementById('minerAddress').value.trim();
  if (!pubKey) {
    alert("Isi dulu wallet address!");
    return;
  }

  document.getElementById('mineOutput').textContent = "⛏️ Mining...";
  const task = await fetch('/mining-task').then(r => r.json());

  let nonce = 0, hash = "";
  while (mining) {
    cubes.forEach(c => c.classList.remove('active'));
    const cube = cubes[nonce % cubes.length];
    cube.classList.add('active');
    moveHammerToCube(cube);

    // Progress bar update
    const progress = (nonce % 100);
    document.getElementById('progressBar').style.width = progress + "%";
    document.getElementById('progressBar').textContent = progress + "%";

    const data = JSON.stringify(task.transactions || []) + task.previousHash + task.timestamp + task.index;
    const buffer = new TextEncoder().encode(data + nonce);
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (hash.startsWith(task.difficulty)) break;
    nonce++;
  }

  if (!mining) return;
  cubes[nonce % cubes.length].classList.add('found');

  const block = {
    index: task.index,
    previousHash: task.previousHash,
    transactions: task.transactions || [],
    nonce,
    hash,
    minerAddress: pubKey,
    signature: hash.slice(0, 32)
  };

  const res = await fetch('/submit-block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(block)
  }).then(r => r.json());

  document.getElementById('mineOutput').textContent = JSON.stringify(res, null, 2);

  if (res.status === 'accepted') {
    showNotification(`✅ Block #${block.index} ditemukan oleh ${pubKey}, reward dibagi proporsional`);
  }
}

// =======================
// Stop Mining
// =======================
document.getElementById('stopBtn').onclick = () => { mining = false; };

// =======================
// Init Chart + Loop Stats
// =======================
window.onload = () => {
  chart = new Chart(document.getElementById('hashrateChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total Hashrate', data: totalHashrateHistory, borderColor: '#0d6efd', tension: 0.3 },
        { label: 'Blocks Found', data: blocksFoundHistory, borderColor: '#28a745', tension: 0.3 },
        { label: 'Reward', data: rewardsHistory, borderColor: '#ffc107', tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#333' } } },
      scales: {
        x: { ticks: { color: '#333' }, grid: { color: '#eee' } },
        y: { ticks: { color: '#333' }, grid: { color: '#eee' } }
      }
    }
  });

  setInterval(fetchStats, 1000);
  document.getElementById('mineBtn').onclick = startMining;
};
