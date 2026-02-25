// rpcAdapter.js
const crypto = require('crypto');
const jsChain = require('./chainInstance'); // pastikan ini instance Blockchain
const walletManager = require('./wallet');

function setupRPC(app) {
  app.post('/rpc', (req, res) => {
    const { method, params, id } = req.body;
    let result;

    try {
      switch(method) {
        // --- Blockchain Info ---
        case 'eth_blockNumber':
          result = '0x' + (jsChain.chain.length - 1).toString(16);
          break;

        case 'eth_chainId':
          result = '0x' + (jsChain.config.chainId).toString(16);
          break;

        case 'eth_getBlockByNumber':
          const index = parseInt(params[0], 16);
          result = jsChain.chain[index] || null;
          break;

        case 'eth_getBlockByHash':
          result = jsChain.chain.find(b => b.hash === params[0]) || null;
          break;

        case 'eth_getBlockTransactionCountByNumber':
          const idx = parseInt(params[0], 16);
          result = '0x' + (jsChain.chain[idx]?.transactions.length || 0).toString(16);
          break;

        case 'eth_getBlockTransactionCountByHash':
          const blk = jsChain.chain.find(b => b.hash === params[0]);
          result = '0x' + (blk?.transactions.length || 0).toString(16);
          break;

        // --- Wallet & Account ---
        case 'eth_accounts':
          result = walletManager.getAll().map(w => w.address);
          break;

        case 'eth_getBalance':
          result = '0x' + jsChain.getBalance(params[0]).toString(16);
          break;

        case 'eth_getTransactionCount':
          result = '0x' + walletManager.getNonce(params[0]).toString(16);
          break;

        // --- Transactions ---
        case 'eth_sendTransaction':
          const tx = params[0];
          const wallet = walletManager.loadWallet(tx.fromName);
          if (!wallet) throw new Error("Wallet not found");
          if (!walletManager.verifySignature(wallet.publicKey, tx.signature, tx)) {
            throw new Error("Invalid signature");
          }
          const newTx = jsChain.createTransaction(wallet, tx.to, tx.value);
          result = crypto.createHash('sha256').update(JSON.stringify(newTx)).digest('hex');
          break;

        case 'eth_sendRawTransaction':
          const rawTx = params[0];
          const decodedTx = JSON.parse(Buffer.from(rawTx, 'hex').toString()); // contoh decode
          if (!walletManager.verifySignature(decodedTx.from, decodedTx.signature, decodedTx)) {
            throw new Error("Invalid rawTx signature");
          }
          const txObj = jsChain.createTransaction({ address: decodedTx.from }, decodedTx.to, decodedTx.value);
          result = crypto.createHash('sha256').update(JSON.stringify(txObj)).digest('hex');
          break;

        case 'eth_getTransactionByHash':
          result = jsChain.getTransactionByHash(params[0]) || null;
          break;

        case 'eth_getTransactionReceipt':
          result = jsChain.getTransactionReceipt(params[0]) || null;
          break;

        // --- Utility ---
        case 'net_version':
          result = jsChain.config.networkId.toString();
          break;

        case 'web3_clientVersion':
          result = "JSChain/1.0.0";
          break;

        case 'eth_gasPrice':
          result = '0x' + (1).toString(16); // dummy gas price
          break;

        case 'eth_estimateGas':
          result = '0x5208'; // default 21000 gas
          break;

        default:
          return res.json({ jsonrpc: "2.0", id, error: "Method not supported" });
      }

      res.json({ jsonrpc: "2.0", id, result });
    } catch (err) {
      res.json({ jsonrpc: "2.0", id, error: err.message });
    }
  });
}

module.exports = setupRPC;
