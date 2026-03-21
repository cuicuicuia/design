const express = require('express');
const cors = require('cors');
const { config } = require('./config');
const { router } = require('./routes');
const { ensureUsersTable, ensureAiCallLogTable, ensureWorkflowTables } = require('./dbInit');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/', router);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error', err);
  res
    .status(500)
    .json({ code: 500, msg: 'Internal Server Error', data: [] });
});

async function start() {
  try {
    await ensureUsersTable();
    await ensureAiCallLogTable();
    await ensureWorkflowTables();
    console.log('[db] users / ai_call_log / workflow tables ensured');
  } catch (e) {
    console.error('[db] ensure users table failed', e);
    process.exit(1);
  }

  app.listen(config.server.port, () => {
    console.log(
      `Node backend listening on http://127.0.0.1:${config.server.port}`,
    );
  });
}

start();

