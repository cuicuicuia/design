const { pgPool } = require('./db');

async function ensureUsersTable() {
  const sql = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  username TEXT,
  password_hash TEXT NOT NULL,
  role SMALLINT NOT NULL DEFAULT 0,
  status SMALLINT NOT NULL DEFAULT 1,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  CONSTRAINT users_email_len_chk CHECK (char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT users_username_len_chk CHECK (username IS NULL OR char_length(username) BETWEEN 2 AND 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uq
  ON users (LOWER(username))
  WHERE username IS NOT NULL AND username <> '';

CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
`;

  const client = await pgPool.connect();
  try {
    // 如果之前创建过旧版表结构（workflow_node 含 node_id 列），则在无数据时自动升级为新结构
    const cols = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'workflow_node'`,
    );
    const hasOld = (cols.rows || []).some((r) => r.column_name === 'node_id');
    if (cols.rows && cols.rows.length > 0) {
      let needRecreate = hasOld;
      if (!needRecreate) {
        // 检查主键是否包含 workflow_id（旧结构主键可能只有 id，导致不同 workflow 的 nodeId 冲突）
        try {
          const pk = await client.query(
            `SELECT a.attname AS col
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = 'workflow_node'::regclass AND i.indisprimary`,
          );
          const pkCols = (pk.rows || []).map((r) => r.col);
          if (pkCols.length > 0 && !pkCols.includes('workflow_id')) needRecreate = true;
        } catch (_) {
          // ignore
        }
      }

      if (needRecreate) {
        const cnt = await client.query('SELECT COUNT(*)::int AS c FROM workflow');
        const c = cnt.rows && cnt.rows[0] ? Number(cnt.rows[0].c || 0) : 0;
        if (c === 0) {
          await client.query(
            'DROP TABLE IF EXISTS workflow_execution_node, workflow_execution, workflow_edge, workflow_node, workflow CASCADE;',
          );
        } else {
          console.warn(
            '[db] detected legacy workflow tables with data; skip auto-migration. Please run a manual migration.',
          );
        }
      }
    }
    await client.query(sql);
  } finally {
    client.release();
  }
}

async function ensureAiCallLogTable() {
  const sql = `
CREATE TABLE IF NOT EXISTS ai_call_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  workflow_id TEXT,
  model_name TEXT NOT NULL,
  prompt_tokens INT,
  completion_tokens INT,
  total_tokens INT,
  cost NUMERIC(12, 6),
  status TEXT NOT NULL,
  duration_ms INT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_call_log_created_at_idx ON ai_call_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_call_log_user_id_idx ON ai_call_log (user_id);
CREATE INDEX IF NOT EXISTS ai_call_log_workflow_id_idx ON ai_call_log (workflow_id);
CREATE INDEX IF NOT EXISTS ai_call_log_model_name_idx ON ai_call_log (model_name);
CREATE INDEX IF NOT EXISTS ai_call_log_status_idx ON ai_call_log (status);
`;

  const client = await pgPool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

async function ensureWorkflowTables() {
  const sql = `
CREATE TABLE IF NOT EXISTS workflow (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_node (
  id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  position_x NUMERIC(12,4) NOT NULL DEFAULT 0,
  position_y NUMERIC(12,4) NOT NULL DEFAULT 0
  ,
  PRIMARY KEY (workflow_id, id)
);

CREATE TABLE IF NOT EXISTS workflow_edge (
  id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  condition_expression TEXT,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb
  ,
  PRIMARY KEY (workflow_id, id)
);

CREATE TABLE IF NOT EXISTS workflow_execution (
  id BIGSERIAL PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workflow_execution_node (
  id BIGSERIAL PRIMARY KEY,
  execution_id BIGINT NOT NULL REFERENCES workflow_execution(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB,
  output JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workflow_node_workflow_id_idx ON workflow_node (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_edge_workflow_id_idx ON workflow_edge (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_execution_workflow_id_idx ON workflow_execution (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_execution_started_at_idx ON workflow_execution (started_at DESC);
CREATE INDEX IF NOT EXISTS workflow_execution_node_execution_id_idx ON workflow_execution_node (execution_id);
`;

  const client = await pgPool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

module.exports = { ensureUsersTable, ensureAiCallLogTable, ensureWorkflowTables };

