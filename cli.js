const readline = require('readline');
const axios = require('axios');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function promptTransaction() {
  rl.question('🧾 From wallet name: ', (from) => {
    rl.question('🎯 To public key: ', (to) => {
      rl.question('💰 Amount: ', async (amount) => {
        try {
          await axios.post('http://localhost:3000/transaction', {
            from,
            to,
            amount: parseFloat(amount)
          });
          console.log('✅ Transaction sent!');
        } catch (err) {
          console.error('❌ Error:', err.message);
        }
        promptTransaction(); // Loop lagi
      });
    });
  });
}

console.log('🚀 CLI Transaction Sender');
promptTransaction();
