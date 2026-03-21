const { pgPool } = require('./db');
const { chatWithModel } = require('./ai');

const CHAT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { content: { type: 'string' } },
  required: ['content'],
};

const EXECUTOR_TRACE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    result: { type: 'object' },
    trace: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          status: { type: 'string' },
          input: { type: 'object' },
          output: { type: 'object' },
          error: { type: 'string' },
        },
        required: ['nodeId', 'status', 'input', 'output'],
      },
    },
  },
  required: ['status', 'result', 'trace'],
};

const DEFAULT_EXECUTOR_TEMPLATE = `以下是一个 AI 工作流定义：

【工作流结构】
nodes:
{{nodes}}

edges:
{{edges}}

【用户输入参数】
{{inputs}}

请你：
1. 根据 edges 构建执行顺序（DAG）
2. 按顺序执行每个节点
3. 每个节点输出必须可以被后续节点引用
4. 生成完整执行日志（execution trace）

输出格式：
{
  "status": "success | error",
  "result": {},
  "trace": [
    {
      "nodeId": "",
      "input": {},
      "output": {},
      "status": ""
    }
  ]
}`;

function generateId() {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const i = Math.floor(x);
  return Math.max(min, Math.min(max, i));
}

function getEdgeHandles(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  return {
    sourceHandle: m.sourceHandle ?? m.source_handle ?? null,
    targetHandle: m.targetHandle ?? m.target_handle ?? null,
  };
}

function shouldPassEdge(expr, value, ctx) {
  if (expr == null || String(expr).trim() === '') return true;
  const s = String(expr).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  try {
    // 轻量表达式：允许用 input / ctx
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', 'ctx', `return Boolean(${s});`);
    return Boolean(fn(value, ctx));
  } catch (_) {
    // 表达式非法时默认不拦截（避免误伤）
    return true;
  }
}

function renderTemplateString(input, vars) {
  if (typeof input !== 'string') return input;
  return input.replace(/\{\{(\s*[\w.:-]+\s*)\}\}/g, (_m, rawKey) => {
    const key = String(rawKey || '').trim();
    const v = vars && Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : undefined;
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch (_) {
      return String(v);
    }
  });
}

function renderMaybe(input, vars) {
  if (typeof input === 'string') return renderTemplateString(input, vars);
  return input;
}

function buildExecutorPrompt(template, nodes, edges, inputs) {
  const t = String(template || DEFAULT_EXECUTOR_TEMPLATE);
  return t
    .replace(/\{\{\s*nodes\s*\}\}/g, JSON.stringify(nodes || [], null, 2))
    .replace(/\{\{\s*edges\s*\}\}/g, JSON.stringify(edges || [], null, 2))
    .replace(/\{\{\s*inputs\s*\}\}/g, JSON.stringify(inputs || {}, null, 2));
}

function buildGraph(nodes, edges) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inEdges = new Map();
  const outEdges = new Map();
  for (const n of nodes) {
    inEdges.set(n.id, []);
    outEdges.set(n.id, []);
  }
  for (const e of edges) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
    inEdges.get(e.target).push(e);
    outEdges.get(e.source).push(e);
  }
  return { nodeMap, inEdges, outEdges };
}

async function runNode(node, inputs, runtimeInput, ctx) {
  const type = node.type || 'start';
  const data = node.data || {};
  const vars = {
    ...(runtimeInput || {}),
    ...(inputs || {}),
    ...(data || {}),
    ...(ctx || {}),
  };

  if (type === 'start') {
    // 允许开始节点在无运行时输入时，回退到节点配置的默认输入
    const v =
      runtimeInput?.user_input ??
      runtimeInput?.input ??
      data.user_input ??
      data.input ??
      '';
    return { trigger: renderMaybe(v, vars) };
  }

  if (type === 'llm') {
    const mode = String(data.mode || 'chat');
    let prompt = renderMaybe(inputs.prompt ?? data.prompt ?? '', vars);
    let system = renderMaybe(inputs.system ?? data.system ?? '你是一个有帮助的助手。', vars);
    // 兼容：如果 prompt 为空，但 system 从上游接收到了内容，
    // 通常说明用户把上游输出连到了 system 输入口。
    // 为满足“每个节点都用上个节点结果处理”，把 system 当作 prompt 回退。
    const promptEmpty = !String(prompt || '').trim();
    const systemFromEdge = Object.prototype.hasOwnProperty.call(inputs || {}, 'system') && !promptEmpty;
    const systemHasEdgeValue = Object.prototype.hasOwnProperty.call(inputs || {}, 'system') && String(inputs.system || '').trim();
    const dataPromptEmpty = !String(data.prompt || '').trim();
    if (promptEmpty && systemHasEdgeValue && dataPromptEmpty) {
      prompt = inputs.system;
      system = renderMaybe(data.system ?? '你是一个有帮助的助手。', vars);
    }
    const modelOpt = data.model === 'gpt-4o' ? 'openai:gpt-4o' : (data.model || 'qwen');
    let messages = { system, user: prompt };
    if (!String(prompt || '').trim()) {
      return { text: '[LLM: empty prompt]' };
    }
    try {
      // LLM 超时可配置：node.data.timeout_ms / timeoutMs（毫秒）
      // 默认 60s，范围 5s~120s（启用搜索/抓取时 20s 往往不够）
      const timeoutMs = clampInt(data.timeout_ms ?? data.timeoutMs, 5000, 120000, 60000);
      const retries = clampInt(data.retries ?? data.retry, 0, 5, 1);
      const maxTokens = clampInt(data.max_tokens ?? data.maxTokens, 64, 4096, 1024);
      const enableSearch = data.enable_search === true || String(data.enable_search || '').toLowerCase() === 'true';
      let schema = CHAT_RESPONSE_SCHEMA;
      if (mode === 'executor_plan') {
        const wfNodes = Array.isArray(ctx?.workflow_nodes) ? ctx.workflow_nodes : [];
        const wfEdges = Array.isArray(ctx?.workflow_edges) ? ctx.workflow_edges : [];
        const tpl = data.executor_template || data.prompt || DEFAULT_EXECUTOR_TEMPLATE;
        messages = {
          system: `${String(system || '你是一个 AI 工作流执行器。')}\n你只生成执行计划与trace，不调用真实外部工具。输出JSON。`,
          user: buildExecutorPrompt(tpl, wfNodes, wfEdges, runtimeInput || {}),
        };
        schema = EXECUTOR_TRACE_SCHEMA;
      }

      const raw = await chatWithModel(messages, schema, {
        model: modelOpt,
        logCtx: ctx ? { user_id: ctx.user_id ?? null, workflow_id: ctx.workflow_id ?? null } : null,
        timeoutMs,
        retries,
        maxTokens,
        enableSearch,
        throwOnFail: true,
      });
      if (!raw) return { text: '[LLM: empty response]' };
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const content = parsed && typeof parsed.content === 'string'
          ? parsed.content
          : JSON.stringify(parsed, null, 2);
        return { text: content };
      } catch (_) {
        return { text: raw };
      }
    } catch (e) {
      return { text: `[LLM Error: ${String(e?.code || e?.message || e)}]` };
    }
  }

  if (type === 'knowledge') {
    const query = renderMaybe(inputs.query ?? data.query ?? '', vars);
    return { result: `[Knowledge: ${query}]` };
  }

  if (type === 'condition') {
    const value = renderMaybe(inputs.value ?? data.value ?? '', vars);
    const expr = String(renderMaybe(data.condition ?? 'true', vars)).trim().toLowerCase();
    let ok = false;
    try {
      if (expr === 'true' || expr === '') ok = Boolean(value);
      else if (expr === 'false') ok = false;
      else ok = Boolean(value);
    } catch (_) {
      ok = false;
    }
    return { yes: ok ? value : undefined, no: !ok ? value : undefined };
  }

  if (type === 'code') {
    const code = renderMaybe(data.code ?? (typeof inputs.code === 'string' ? inputs.code : 'return input;'), vars);
    const inputVal = renderMaybe(inputs.input ?? data.input ?? '', vars);
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', code);
    const result = fn(inputVal);
    return { result: result !== undefined ? String(result) : '' };
  }

  if (type === 'http') {
    const url = renderMaybe(inputs.url ?? data.url ?? '', vars);
    const method = String(renderMaybe(inputs.method ?? data.method ?? 'GET', vars)).toUpperCase();
    const body = renderMaybe(inputs.body ?? data.body, vars);
    const opts = { method };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    try {
      return { response: JSON.parse(text) };
    } catch (_) {
      return { response: text };
    }
  }

  if (type === 'end') {
    return { result: inputs.result ?? inputs.input ?? '' };
  }

  return {};
}

async function getList(organizationId) {
  const client = await pgPool.connect();
  try {
    const r = await client.query(
      `SELECT id, name, organization_id, status, version, created_at
       FROM workflow
       WHERE organization_id=$1
       ORDER BY created_at DESC
       LIMIT 200`,
      [organizationId],
    );
    return r.rows || [];
  } finally {
    client.release();
  }
}

async function getPublicList(limit = 200) {
  const client = await pgPool.connect();
  try {
    const lim = clampInt(limit, 1, 500, 200);
    const r = await client.query(
      `SELECT id, name, organization_id, status, version, created_at
       FROM workflow
       WHERE status='public'
       ORDER BY created_at DESC
       LIMIT $1`,
      [lim],
    );
    return r.rows || [];
  } finally {
    client.release();
  }
}

async function getOne(id, requesterOrgId) {
  const client = await pgPool.connect();
  try {
    const w = await client.query(
      `SELECT id, name, organization_id, status, version, created_at
       FROM workflow
       WHERE id=$1 AND (organization_id=$2 OR status='public')
       LIMIT 1`,
      [id, requesterOrgId],
    );
    if (w.rows.length === 0) return null;

    const nodes = await client.query(
      `SELECT id, node_type, config_json, position_x, position_y
       FROM workflow_node
       WHERE workflow_id=$1`,
      [id],
    );
    const edges = await client.query(
      `SELECT id, source_node_id, target_node_id, condition_expression, meta_json
       FROM workflow_edge
       WHERE workflow_id=$1`,
      [id],
    );

    const nodeArr = (nodes.rows || []).map((n) => ({
      id: n.id,
      type: n.node_type,
      position: { x: Number(n.position_x || 0), y: Number(n.position_y || 0) },
      data: n.config_json || {},
    }));

    const edgeArr = (edges.rows || []).map((e) => {
      const { sourceHandle, targetHandle } = getEdgeHandles(e.meta_json);
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: sourceHandle || undefined,
        targetHandle: targetHandle || undefined,
        data: e.condition_expression ? { condition_expression: e.condition_expression } : {},
      };
    });

    return { ...w.rows[0], nodes: nodeArr, edges: edgeArr };
  } finally {
    client.release();
  }
}

async function saveOne(workflow, organizationId) {
  const id = workflow.id || generateId();
  const name = String(workflow.name || '未命名工作流');
  const status = String(workflow.status || 'active');
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const edges = Array.isArray(workflow.edges) ? workflow.edges : [];

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    // 若存在则 version+1；否则 version=1
    const up = await client.query(
      `
      INSERT INTO workflow (id, name, organization_id, status, version)
      VALUES ($1,$2,$3,$4,1)
      ON CONFLICT (id) DO UPDATE
        SET name=EXCLUDED.name,
            status=EXCLUDED.status,
            version=workflow.version + 1
      WHERE workflow.organization_id = EXCLUDED.organization_id
      RETURNING id, name, organization_id, status, version, created_at
      `,
      [id, name, organizationId, status],
    );
    if (up.rows.length === 0) {
      throw new Error('workflow not found or permission denied');
    }

    await client.query('DELETE FROM workflow_node WHERE workflow_id=$1', [id]);
    await client.query('DELETE FROM workflow_edge WHERE workflow_id=$1', [id]);

    for (const n of nodes) {
      const nodeId = String(n.id);
      const nodeType = String(n.type || 'start');
      const data = n.data && typeof n.data === 'object' ? n.data : {};
      const pos = n.position || {};
      await client.query(
        `INSERT INTO workflow_node (id, workflow_id, node_type, config_json, position_x, position_y)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          nodeId,
          id,
          nodeType,
          JSON.stringify(data),
          Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0,
          Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0,
        ],
      );
    }

    for (const e of edges) {
      const edgeId = String(e.id || `e_${e.source}_${e.target}_${Math.random().toString(36).slice(2, 7)}`);
      const meta = {
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      };
      const cond =
        (e.data && typeof e.data === 'object' && e.data.condition_expression) || null;
      await client.query(
        `INSERT INTO workflow_edge (id, workflow_id, source_node_id, target_node_id, condition_expression, meta_json)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          edgeId,
          id,
          String(e.source),
          String(e.target),
          cond ? String(cond) : null,
          JSON.stringify(meta),
        ],
      );
    }

    await client.query('COMMIT');
    return { ...up.rows[0], nodes, edges };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function listExecutions(workflowId, organizationId, limit = 20) {
  const client = await pgPool.connect();
  try {
    // 校验权限
    const w = await client.query(
      "SELECT 1 FROM workflow WHERE id=$1 AND (organization_id=$2 OR status='public') LIMIT 1",
      [workflowId, organizationId],
    );
    if (w.rows.length === 0) return [];
    const lim = clampInt(limit, 1, 200, 20);
    const r = await client.query(
      `SELECT id, workflow_id, status, started_at, finished_at
       FROM workflow_execution
       WHERE workflow_id=$1
       ORDER BY started_at DESC
       LIMIT $2`,
      [workflowId, lim],
    );
    return r.rows || [];
  } finally {
    client.release();
  }
}

async function getExecution(executionId, organizationId) {
  const client = await pgPool.connect();
  try {
    const ex = await client.query(
      `SELECT e.id, e.workflow_id, e.status, e.input_json, e.output_json, e.started_at, e.finished_at
       FROM workflow_execution e
       JOIN workflow w ON w.id = e.workflow_id
       WHERE e.id=$1 AND (w.organization_id=$2 OR w.status='public')
       LIMIT 1`,
      [executionId, organizationId],
    );
    if (ex.rows.length === 0) return null;
    const nodes = await client.query(
      `SELECT id, node_id, status, input, output, error_message, started_at, finished_at
       FROM workflow_execution_node
       WHERE execution_id=$1
       ORDER BY id ASC`,
      [executionId],
    );
    return { ...ex.rows[0], nodes: nodes.rows || [] };
  } finally {
    client.release();
  }
}

function computeTopoOrder(nodes, edges) {
  const { nodeMap, inEdges, outEdges } = buildGraph(nodes, edges);
  const inDegree = new Map();
  for (const n of nodes) inDegree.set(n.id, (inEdges.get(n.id) || []).length);
  const queue = [];
  for (const [id, deg] of inDegree.entries()) if (deg === 0) queue.push(id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of outEdges.get(id) || []) {
      const to = e.target;
      inDegree.set(to, inDegree.get(to) - 1);
      if (inDegree.get(to) === 0) queue.push(to);
    }
  }
  return { order, nodeMap, inEdges, outEdges };
}

function buildReadyQueueStepState(nodes, edges, nodeResults) {
  const { nodeMap, inEdges, outEdges } = buildGraph(nodes, edges);
  const queued = new Set();
  const finished = new Set(Object.keys(nodeResults || {}));
  const q = [];
  // 规则：start 节点优先；其他节点只要其全部入边 source 已完成即可入队
  for (const n of nodes) {
    const ins = inEdges.get(n.id) || [];
    const depsReady = ins.every((e) => finished.has(String(e.source)));
    if (n.type === 'start' || depsReady) {
      if (!finished.has(String(n.id)) && !queued.has(String(n.id))) {
        q.push(String(n.id));
        queued.add(String(n.id));
      }
    }
  }
  return { q, nodeMap, inEdges, outEdges };
}

/**
 * 单步执行：每次调用只执行一个“当前可运行节点”
 * - 默认前端控制 DAG 推进（自动下一步）
 * - 支持含回边的图（loop）：不再直接因为 cycle 失败
 * state 存在 workflow_execution.output_json.step_state
 */
async function runStep(workflowId, organizationId, runtimeInput, ctx, executionId) {
  const wf = await getOne(workflowId, organizationId);
  if (!wf) throw new Error('workflow not found');
  const nodes = wf.nodes || [];
  const edges = wf.edges || [];
  const execCtx = { ...(ctx || {}), workflow_nodes: nodes, workflow_edges: edges };

  // init / load execution
  let exId = executionId;
  if (!exId) {
    const init = buildReadyQueueStepState(nodes, edges, {});
    const ex = await pgPool.query(
      `INSERT INTO workflow_execution (workflow_id, status, input_json, output_json)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [
        workflowId,
        'running',
        JSON.stringify(runtimeInput || {}),
        JSON.stringify({
          step_state: {
            queue: init.q,
            nodeResults: {},
            outputs: [],
            loops: 0,
            maxLoops: 1000,
            loopCounts: {},
          },
        }),
      ],
    );
    exId = ex.rows[0].id;
  }

  const exRow = await pgPool.query(
    `SELECT status, input_json, output_json
     FROM workflow_execution
     WHERE id=$1 AND workflow_id=$2
     LIMIT 1`,
    [exId, workflowId],
  );
  if (exRow.rows.length === 0) throw new Error('execution not found');
  const exStatus = exRow.rows[0].status;
  if (exStatus !== 'running') {
    return { success: exStatus === 'success', done: true, executionId: exId };
  }

  const inputJson = exRow.rows[0].input_json || {};
  const outJson = exRow.rows[0].output_json || {};
  const state = (outJson && outJson.step_state)
    ? outJson.step_state
    : { queue: [], nodeResults: {}, outputs: [], loops: 0, maxLoops: 1000, loopCounts: {} };
  const nodeResults = state.nodeResults && typeof state.nodeResults === 'object' ? state.nodeResults : {};
  let queue = Array.isArray(state.queue) ? state.queue.map((x) => String(x)) : [];
  const loops = Number(state.loops || 0);
  const maxLoops = clampInt(state.maxLoops, 10, 5000, 1000);
  const loopCounts = state.loopCounts && typeof state.loopCounts === 'object' ? state.loopCounts : {};

  if (loops > maxLoops) {
    await pgPool.query(
      `UPDATE workflow_execution
       SET status=$2, output_json=$3, finished_at=NOW()
       WHERE id=$1`,
      [exId, 'fail', JSON.stringify({ error: 'loop_limit_exceeded', step_state: state })],
    );
    return { success: false, done: true, executionId: exId, error: 'loop_limit_exceeded' };
  }

  // 补队列：若当前为空，重新扫描可运行节点（支持分支和回路）
  if (queue.length === 0) {
    const ready = buildReadyQueueStepState(nodes, edges, nodeResults);
    queue = ready.q;
  }

  if (queue.length === 0) {
    return { success: true, done: true, executionId: exId, outputs: state.outputs || [], nodeResults };
  }

  const nodeId = String(queue.shift());
  const g = buildGraph(nodes, edges);
  const nodeMap = g.nodeMap;
  const inEdges = g.inEdges;
  const outEdges = g.outEdges;
  const node = nodeMap.get(nodeId);
  if (!node) throw new Error('node not found');

  // build inputs from saved nodeResults
  const inputs = {};
  const edgeCtx = { nodeResults };
  for (const e of inEdges.get(nodeId) || []) {
    const upstream = nodeResults[e.source];
    if (!upstream) continue;
    const sourceHandle = e.sourceHandle;
    const targetHandle = e.targetHandle;
    const val = sourceHandle ? upstream[sourceHandle] : Object.values(upstream)[0];
    if (!shouldPassEdge(e?.data?.condition_expression, val, edgeCtx)) continue;
    if (val !== undefined) inputs[targetHandle || 'input'] = val;
  }

  const execNodeRow = await pgPool.query(
    `INSERT INTO workflow_execution_node (execution_id, node_id, status, input, started_at)
     VALUES ($1,$2,$3,$4,NOW())
     RETURNING id`,
    [exId, nodeId, 'running', JSON.stringify(inputs)],
  );
  const execNodeId = execNodeRow.rows[0].id;

  try {
    const out = await runNode(node, inputs, inputJson, execCtx);
    await pgPool.query(
      `UPDATE workflow_execution_node
       SET status=$2, output=$3, finished_at=NOW()
       WHERE id=$1`,
      [execNodeId, 'success', JSON.stringify(out || {})],
    );

    nodeResults[nodeId] = out || {};

    // if end node, accumulate outputs
    let outputs = Array.isArray(state.outputs) ? state.outputs : [];
    if (node.type === 'end') {
      outputs = [...outputs, (out && (out.result ?? out.input ?? '')) || ''];
    }

    // 执行完当前节点后，把其下游若满足依赖则入队（避免一次性计算）
    for (const e of outEdges.get(nodeId) || []) {
      const targetId = String(e.target)
      if (queue.includes(targetId)) continue

      const hasResult = Object.prototype.hasOwnProperty.call(nodeResults, targetId)
      if (hasResult) {
        const targetNode = nodeMap.get(targetId)
        const loopable = Boolean(targetNode?.data?.loop || targetNode?.data?.loopable)
        if (!loopable) continue
        const currentCount = Number(loopCounts[targetId] || 0)
        const maxRuns = clampInt(
          targetNode?.data?.loop_max_runs ?? targetNode?.data?.loopMaxRuns ?? targetNode?.data?.max_runs ?? 10,
          1,
          50,
          10,
        )
        if (currentCount >= maxRuns) continue
      }

      const deps = inEdges.get(targetId) || []
      const ready = deps.every((de) => Object.prototype.hasOwnProperty.call(nodeResults, String(de.source)))
      if (ready) queue.push(targetId)
    }

    // 当前节点完成次数 +1（用于 loopable 节点控制）
    loopCounts[nodeId] = Number(loopCounts[nodeId] || 0) + 1

    const nextState = {
      queue,
      nodeResults,
      outputs,
      loops: loops + 1,
      maxLoops,
      loopCounts,
      last: { nodeId, input: inputs, output: out || {} },
    };

    const done = queue.length === 0;
    if (done) {
      await pgPool.query(
        `UPDATE workflow_execution
         SET status=$2, output_json=$3, finished_at=NOW()
         WHERE id=$1`,
        [exId, 'success', JSON.stringify({ success: true, outputs, nodeResults, step_state: nextState })],
      );
    } else {
      await pgPool.query(
        `UPDATE workflow_execution
         SET output_json=$2
         WHERE id=$1`,
        [exId, JSON.stringify({ ...outJson, step_state: nextState })],
      );
    }

    return {
      success: true,
      done,
      executionId: exId,
      currentNodeId: nodeId,
      currentInput: inputs,
      currentOutput: out || {},
      cursor: loops + 1,
      total: undefined,
      outputs: done ? outputs : undefined,
      nodeResults: done ? nodeResults : undefined,
    };
  } catch (e) {
    const errText = String(e.message || e)
    await pgPool.query(
      `UPDATE workflow_execution_node
       SET status=$2, error_message=$3, finished_at=NOW()
       WHERE id=$1`,
      [execNodeId, 'fail', errText],
    )

    const continueOnError = Boolean(node?.data?.continue_on_error || node?.data?.continueOnError)
    if (!continueOnError) {
      await pgPool.query(
        `UPDATE workflow_execution
         SET status=$2, output_json=$3, finished_at=NOW()
         WHERE id=$1`,
        [exId, 'fail', JSON.stringify({ error: errText, step_state: { ...state, queue, loops } })],
      )
      return { success: false, done: true, executionId: exId, error: errText }
    }

    // continue_on_error=true：把失败作为可解析的 JSON 写入 nodeResults，并继续调度下游
    nodeResults[nodeId] = { error: errText }
    let outputs = Array.isArray(state.outputs) ? state.outputs : []
    if (node.type === 'end') {
      // end 节点失败时，仍可输出错误文本（或空串）
      outputs = [...outputs, errText]
    }

    // 当前节点完成次数 +1（用于 loopable 节点控制）
    loopCounts[nodeId] = Number(loopCounts[nodeId] || 0) + 1

    // requeue 下游（与 success 分支一致，支持 loopable）
    for (const e of outEdges.get(nodeId) || []) {
      const targetId = String(e.target)
      if (queue.includes(targetId)) continue

      const hasResult = Object.prototype.hasOwnProperty.call(nodeResults, targetId)
      if (hasResult) {
        const targetNode = nodeMap.get(targetId)
        const loopable = Boolean(targetNode?.data?.loop || targetNode?.data?.loopable)
        if (!loopable) continue
        const currentCount = Number(loopCounts[targetId] || 0)
        const maxRuns = clampInt(
          targetNode?.data?.loop_max_runs ?? targetNode?.data?.loopMaxRuns ?? targetNode?.data?.max_runs ?? 10,
          1,
          50,
          10,
        )
        if (currentCount >= maxRuns) continue
      }

      const deps = inEdges.get(targetId) || []
      const ready = deps.every((de) => Object.prototype.hasOwnProperty.call(nodeResults, String(de.source)))
      if (ready) queue.push(targetId)
    }

    const nextState = {
      queue,
      nodeResults,
      outputs,
      loops: loops + 1,
      maxLoops,
      loopCounts,
      last: { nodeId, input: inputs, output: {}, error: errText },
    }

    const done = queue.length === 0
    if (done) {
      await pgPool.query(
        `UPDATE workflow_execution
         SET status=$2, output_json=$3, finished_at=NOW()
         WHERE id=$1`,
        [exId, 'success', JSON.stringify({ success: true, outputs, nodeResults, step_state: nextState })],
      )
    } else {
      await pgPool.query(
        `UPDATE workflow_execution
         SET output_json=$2
         WHERE id=$1`,
        [exId, JSON.stringify({ ...outJson, step_state: nextState })],
      )
    }

    return {
      success: true,
      done,
      executionId: exId,
      currentNodeId: nodeId,
      currentInput: inputs,
      currentOutput: {},
      cursor: loops + 1,
      total: undefined,
      outputs: done ? outputs : undefined,
      nodeResults: done ? nodeResults : undefined,
    }
  }
}

async function run(workflowId, organizationId, runtimeInput, ctx) {
  const client = await pgPool.connect();
  try {
    const wf = await getOne(workflowId, organizationId);
    if (!wf) throw new Error('workflow not found');

    await client.query('BEGIN');
    const ex = await client.query(
      `INSERT INTO workflow_execution (workflow_id, status, input_json)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [workflowId, 'running', JSON.stringify(runtimeInput || {})],
    );
    const executionId = ex.rows[0].id;
    await client.query('COMMIT');

    const nodes = wf.nodes || [];
    const edges = wf.edges || [];
    const execCtx = { ...(ctx || {}), workflow_nodes: nodes, workflow_edges: edges };
    const { nodeMap, inEdges, outEdges } = buildGraph(nodes, edges);

    // 拓扑排序（Kahn）
    const inDegree = new Map();
    for (const n of nodes) inDegree.set(n.id, (inEdges.get(n.id) || []).length);
    const queue = [];
    for (const [id, deg] of inDegree.entries()) if (deg === 0) queue.push(id);

    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const e of outEdges.get(id) || []) {
        const to = e.target;
        inDegree.set(to, inDegree.get(to) - 1);
        if (inDegree.get(to) === 0) queue.push(to);
      }
    }
    if (order.length !== nodes.length) {
      await pgPool.query(
        `UPDATE workflow_execution SET status=$2, output_json=$3, finished_at=NOW() WHERE id=$1`,
        [executionId, 'fail', JSON.stringify({ error: 'cycle_detected' })],
      );
      return { success: false, outputs: [], nodeResults: {}, executionId, error: 'cycle_detected' };
    }

    const results = new Map(); // nodeId -> outputs

    for (const nodeId of order) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const inputs = {};
      const edgeCtx = { nodeResults: Object.fromEntries(results.entries()) };
      for (const e of inEdges.get(nodeId) || []) {
        const upstream = results.get(e.source);
        if (!upstream) continue;
        const sourceHandle = e.sourceHandle;
        const targetHandle = e.targetHandle;
        const val = sourceHandle ? upstream[sourceHandle] : Object.values(upstream)[0];
        if (!shouldPassEdge(e?.data?.condition_expression, val, edgeCtx)) continue;
        if (val !== undefined) inputs[targetHandle || 'input'] = val;
      }

      const execNodeRow = await pgPool.query(
        `INSERT INTO workflow_execution_node (execution_id, node_id, status, input, started_at)
         VALUES ($1,$2,$3,$4,NOW())
         RETURNING id`,
        [executionId, nodeId, 'running', JSON.stringify(inputs)],
      );
      const execNodeId = execNodeRow.rows[0].id;

      const maxRetries = clampInt(node.data?.max_retries ?? node.data?.retry ?? 0, 0, 5, 0);
      let attempt = 0;
      let out = null;
      let lastErr = null;
      while (attempt <= maxRetries) {
        try {
          out = await runNode(node, inputs, runtimeInput, execCtx);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          attempt += 1;
          if (attempt > maxRetries) break;
        }
      }

      if (lastErr) {
        await pgPool.query(
          `UPDATE workflow_execution_node
           SET status=$2, error_message=$3, finished_at=NOW()
           WHERE id=$1`,
          [execNodeId, 'fail', String(lastErr.message || lastErr)],
        );
        await pgPool.query(
          `UPDATE workflow_execution
           SET status=$2, output_json=$3, finished_at=NOW()
           WHERE id=$1`,
          [executionId, 'fail', JSON.stringify({ error: String(lastErr.message || lastErr) })],
        );
        return { success: false, outputs: [], nodeResults: Object.fromEntries(results.entries()), executionId };
      }

      results.set(nodeId, out || {});
      await pgPool.query(
        `UPDATE workflow_execution_node
         SET status=$2, output=$3, finished_at=NOW()
         WHERE id=$1`,
        [execNodeId, 'success', JSON.stringify(out || {})],
      );
    }

    const endNodes = nodes.filter((n) => n.type === 'end');
    const outputs = [];
    for (const n of endNodes) {
      const r = results.get(n.id);
      if (r) outputs.push(r.result ?? r.input ?? '');
    }

    const nodeResults = Object.fromEntries(results.entries());
    await pgPool.query(
      `UPDATE workflow_execution
       SET status=$2, output_json=$3, finished_at=NOW()
       WHERE id=$1`,
      [executionId, 'success', JSON.stringify({ success: true, outputs, nodeResults })],
    );

    return { success: true, outputs, nodeResults, executionId };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  generateId,
  getList,
  getOne,
  getPublicList,
  saveOne,
  runStep,
  run,
  listExecutions,
  getExecution,
};

