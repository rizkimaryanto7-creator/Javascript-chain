const Blockchain = require('./chain');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const CFG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const jsChain = new Blockchain(null, CFG);

module.exports = jsChain;
