const { Rcon } = require('rcon-client');
require('dotenv').config({ path: '../mc-bot/.env' });

async function run() {
  try {
    const rcon = new Rcon({ host: '127.0.0.1', port: 25575, password: process.env.RCON_PASSWORD });
    await rcon.connect();
    const res = await rcon.send('tps');
    console.log('RAW_START');
    console.log(JSON.stringify(res));
    console.log('RAW_END');
    rcon.end();
  } catch (e) {
    console.log('ERR: ' + e.message);
  }
}

run();
