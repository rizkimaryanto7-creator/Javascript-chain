# Javascript-chain 🚀
Model beta dari blockchain modular yang bisa ditambang dari Browser HP, Termux, atau APK.

🔓 Open source & transparan  
📊 Monitoring miner & wallet  
📁 Struktur modular & recovery atomic

[📘 Dokumentasi](docs.md) | [💡 Kontribusi](CONTRIBUTING.md)

🛠️ Panduan Mining JS-Chain via Browser (Tanpa Install APK)

🌐 Link Akses:
- 🔍 Explorer → untuk lihat block, TX, dan miner aktif
- 💼 Wallet → untuk buat atau import wallet
- ⛏️ Miner → untuk mulai mining langsung dari HP atau laptop

---

🧭 Langkah-Langkah Mining

1. load Wallet
- Buka Wallet Page
- Isi nama wallet → klik Create Wallet
- Salin public key yang muncul → ini akan jadi alamat miner kamu
- Jangan bagikan private key ke siapa pun

2. start Mining
- Buka Miner Dashboard
- Masukkan address wallet kamu di kolom miner
- Klik Start Mining
- Dashboard akan menampilkan:
  - ⛓️ Block height
  - 🎯 Difficulty
  - ⚡ Hashrate per core
  - 🧠 Best hash
  - 🕒 ETA block berikutnya

3. Cek history Mining
- Buka Explorer
- Cari block terbaru → klik untuk lihat siapa yang menambang
- Klik address kamu → lihat saldo dan histori TX.

#link to Explorers  : https://constantly-moses-supplements-hack.trycloudflare.com/Explorer

#link to wallet  : https://constantly-moses-supplements-hack.trycloudflare.com/wallets

#link to miner  : https://constantly-moses-supplements-hack.trycloudflare.com/miner

guide : 

# Cara Fork & Setup

## 1. Clone Repo
```bash
git clone https://github.com/rizkimaryanto7-creator/Javascript-chain.git

## 2. Install Dependencies
`bash
npm install
`

## 3. Jalankan Node Local
`bash
npm run dev
`

## 4. Struktur Modular
- node.js : start blockchain (Genesis)
- remove chain.js : Genesis ( remove )
- wallet.js: Command center wallet
- miner.js: Loop mining
- explorer.js: Query chain
- governance.js: Voting & plugin loader

## 5. Plugin & Ekstensi
Fork bisa menambahkan:
- Plugin miner custom
- Governance rules
- Firestore sync
- QR code & polling

## 6. Kontribusi
Buat branch baru:
`bash
git checkout -b fitur-anda
`
pull & request.

## 7. Backup & Recovery
Gunakan chain.json dan wallet-backup.json untuk recovery multi-device.
.