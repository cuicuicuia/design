const Redis = require('ioredis');
const { config } = require('./config');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  db: config.redis.db,
  password: config.redis.password,
});

redis.on('error', (err) => {
  console.error('Redis error', err);
});

module.exports = { redis };

