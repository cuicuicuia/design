const { Pool } = require('pg');
const { config } = require('./config');

const pgPool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  user: config.pg.user,
  password: config.pg.password,
  database: config.pg.database,
});

pgPool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});

module.exports = { pgPool };

