const { pgPool } = require('./db');

async function insertAiCallLog(payload) {
  const {
    user_id,
    workflow_id,
    model_name,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost,
    status,
    duration_ms,
    error_message,
  } = payload || {};

  // 必填字段最小校验
  if (!model_name || !status) return;

  const client = await pgPool.connect();
  try {
    await client.query(
      `INSERT INTO ai_call_log
        (user_id, workflow_id, model_name, prompt_tokens, completion_tokens, total_tokens, cost, status, duration_ms, error_message)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        user_id ?? null,
        workflow_id ?? null,
        String(model_name),
        Number.isFinite(prompt_tokens) ? prompt_tokens : null,
        Number.isFinite(completion_tokens) ? completion_tokens : null,
        Number.isFinite(total_tokens) ? total_tokens : null,
        typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
        String(status),
        Number.isFinite(duration_ms) ? duration_ms : null,
        error_message ? String(error_message).slice(0, 2000) : null,
      ],
    );
  } catch (e) {
    // 日志写入失败不影响主流程
    console.error('[ai_call_log] insert failed', e);
  } finally {
    client.release();
  }
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const i = Math.floor(x);
  return Math.max(min, Math.min(max, i));
}

async function listAiCallLogs({
  viewerUserId,
  isAdmin,
  limit,
  offset,
  status,
  model_name,
  workflow_id,
  from,
  to,
}) {
  const lim = clampInt(limit, 1, 200, 50);
  const off = clampInt(offset, 0, 100000, 0);
  const where = [];
  const args = [];
  let idx = 1;

  if (!isAdmin) {
    where.push(`user_id = $${idx++}`);
    args.push(viewerUserId);
  } else if (viewerUserId) {
    // admin 也可以指定 user_id（可选）
  }

  if (status) {
    where.push(`status = $${idx++}`);
    args.push(String(status));
  }
  if (model_name) {
    where.push(`model_name = $${idx++}`);
    args.push(String(model_name));
  }
  if (workflow_id) {
    where.push(`workflow_id = $${idx++}`);
    args.push(String(workflow_id));
  }
  if (from) {
    where.push(`created_at >= $${idx++}`);
    args.push(new Date(from));
  }
  if (to) {
    where.push(`created_at <= $${idx++}`);
    args.push(new Date(to));
  }

  const sql =
    `SELECT id, user_id, workflow_id, model_name, prompt_tokens, completion_tokens, total_tokens, cost, status, duration_ms, error_message, created_at
     FROM ai_call_log` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}`;
  args.push(lim, off);

  const client = await pgPool.connect();
  try {
    const r = await client.query(sql, args);
    return r.rows || [];
  } finally {
    client.release();
  }
}

async function getAiCallStats({ viewerUserId, isAdmin, from, to }) {
  const where = [];
  const args = [];
  let idx = 1;
  if (!isAdmin) {
    where.push(`user_id = $${idx++}`);
    args.push(viewerUserId);
  }
  if (from) {
    where.push(`created_at >= $${idx++}`);
    args.push(new Date(from));
  }
  if (to) {
    where.push(`created_at <= $${idx++}`);
    args.push(new Date(to));
  }

  const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const client = await pgPool.connect();
  try {
    const totals = await client.query(
      `
      SELECT
        COUNT(*)::int AS calls,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END),0)::int AS success_calls,
        COALESCE(SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END),0)::int AS failed_calls,
        COALESCE(SUM(prompt_tokens),0)::bigint AS prompt_tokens,
        COALESCE(SUM(completion_tokens),0)::bigint AS completion_tokens,
        COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
        COALESCE(SUM(cost),0)::numeric AS cost
      FROM ai_call_log
      ${baseWhere}
      `,
      args,
    );

    const byDayAndModel = await client.query(
      `
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        model_name,
        COUNT(*)::int AS calls,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS success_calls,
        SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END)::int AS failed_calls,
        COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
        COALESCE(SUM(cost),0)::numeric AS cost
      FROM ai_call_log
      ${baseWhere}
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2 ASC
      LIMIT 200
      `,
      args,
    );

    return {
      totals: totals.rows?.[0] || null,
      series: byDayAndModel.rows || [],
    };
  } finally {
    client.release();
  }
}

module.exports = { insertAiCallLog, listAiCallLogs, getAiCallStats };

