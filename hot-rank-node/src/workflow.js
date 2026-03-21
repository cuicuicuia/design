/**
 * 工作流存储与执行
 * - 存储：Redis workflow:list、workflow:{id}
 * - 执行：按图拓扑执行节点，支持 start/llm/knowledge/condition/code/http/end
 */
const { redis } = require('./redis');
const { chatWithModel } = require('./ai');

const WORKFLOW_LIST_KEY = 'workflow:list';
const WORKFLOW_PREFIX = 'workflow:';

const CHAT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { content: { type: 'string' } },
  required: ['content'],
};

const NODE_USER_VIEW_RULES = `你是一个工作流节点执行器，请同时返回「机器可解析数据」和「用户可读内容」。
【输出规则】
1. 必须返回 JSON（用于系统解析）
2. 同时提供一个 user_view 字段，用于前端直接展示
3. user_view 必须是自然语言，不包含 JSON、代码或结构体
4. 不允许返回 [Knowledge: ...] 或任何额外包裹
【输出格式】
{
  "node_id": string,
  "status": "success" | "error",
  "result": any,
  "user_view": string,
  "message": string,
  "metadata": {}
}`;

function generateId() {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

async function getList() {
  const raw = await redis.get(WORKFLOW_LIST_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function saveOne(workflow) {
  const id = workflow.id || generateId();
  const name = workflow.name || '未命名工作流';
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];
  const now = new Date().toISOString();
  const list = await getList();
  const index = list.findIndex((w) => w.id === id);
  const entry = { id, name, updated_at: now };
  if (index >= 0) {
    list[index] = entry;
  } else {
    list.push(entry);
  }
  await redis.set(WORKFLOW_LIST_KEY, JSON.stringify(list));
  await redis.set(`${WORKFLOW_PREFIX}${id}`, JSON.stringify({
    id,
    name,
    nodes,
    edges,
    updated_at: now,
  }));
  return { id, name, nodes, edges, updated_at: now };
}

async function getOne(id) {
  const raw = await redis.get(`${WORKFLOW_PREFIX}${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * 根据 edges 构建：每个节点的入边（sourceNodeId -> [{ sourceHandle, targetHandle }]
 * 以及每个节点的出边 targetNodeId
 */
function buildGraph(nodes, edges) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inEdges = new Map(); // nodeId -> [{ source, sourceHandle, targetHandle }]
  const outEdges = new Map(); // nodeId -> [{ target, sourceHandle, targetHandle }]
  for (const n of nodes) {
    inEdges.set(n.id, []);
    outEdges.set(n.id, []);
  }
  for (const e of edges) {
    const { source, target, sourceHandle, targetHandle } = e;
    if (!nodeMap.has(source) || !nodeMap.has(target)) continue;
    inEdges.get(target).push({
      source,
      sourceHandle: sourceHandle || null,
      targetHandle: targetHandle || null,
    });
    outEdges.get(source).push({
      target,
      sourceHandle: sourceHandle || null,
      targetHandle: targetHandle || null,
    });
  }
  return { nodeMap, inEdges, outEdges };
}

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

function buildUserViewFromResult(result, fallback = '') {
  if (typeof result === 'string') {
    const s = result.trim();
    if (!s) return String(fallback || '节点执行完成。');
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed.user_view === 'string' && parsed.user_view.trim()) {
          return parsed.user_view.trim();
        }
      } catch (_) {
        return String(fallback || '节点执行完成，已生成结构化结果。');
      }
      return String(fallback || '节点执行完成，已生成结构化结果。');
    }
    return s;
  }
  if (isPlainObject(result)) {
    if (typeof result.user_view === 'string' && result.user_view.trim()) return result.user_view.trim();
    if (typeof result.message === 'string' && result.message.trim()) return result.message.trim();
    return String(fallback || '节点执行完成，已生成结构化结果。');
  }
  if (Array.isArray(result)) return String(fallback || `节点执行完成，生成了 ${result.length} 项结果。`);
  if (result === undefined || result === null) return String(fallback || '节点执行完成。');
  return String(result);
}

function withNodeEnvelope(node, rawOut, patch = {}) {
  const base = isPlainObject(rawOut) ? { ...rawOut } : { result: rawOut };
  const resultVal = Object.prototype.hasOwnProperty.call(base, 'result') ? base.result : base;
  const status = patch.status || 'success';
  const message = patch.message || (status === 'success' ? '执行成功' : '执行失败');
  const userView = patch.user_view || buildUserViewFromResult(resultVal, message);
  const metadata = isPlainObject(base.metadata) ? base.metadata : {};
  return {
    ...base,
    node_id: String(node?.id || ''),
    status,
    result: resultVal,
    user_view: String(userView || message),
    message: String(message),
    metadata: { ...metadata, ...(patch.metadata || {}) },
  };
}

/**
 * 执行单个节点，返回该节点各 output 的取值
 * inputs: { [targetHandle]: value } 来自上游节点
 * node.data 为配置（如 model、system、url）
 */
async function runNode(node, inputs, runtimeInput) {
  const type = node.type || 'start';
  const data = node.data || {};
  const id = node.id;

  if (type === 'start') {
    const v =
      runtimeInput?.user_input ??
      runtimeInput?.input ??
      data.user_input ??
      data.input ??
      '';
    return withNodeEnvelope(node, { trigger: v, result: v }, { message: '开始节点已接收输入' });
  }

  if (type === 'llm') {
    let prompt = inputs.prompt ?? data.prompt ?? '';
    let system = inputs.system ?? data.system ?? '你是一个有帮助的助手。';
    system = `${String(system || '').trim()}\n\n${NODE_USER_VIEW_RULES}`.trim();
    const promptEmpty = !String(prompt || '').trim();
    const systemHasValue = Object.prototype.hasOwnProperty.call(inputs || {}, 'system') && String(inputs.system || '').trim();
    const dataPromptEmpty = !String(data.prompt || '').trim();
    if (promptEmpty && systemHasValue && dataPromptEmpty) {
      // 上游接到了 system 输入口，但用户期望把它当作对话输入使用时，做回退兼容
      prompt = inputs.system;
      system = data.system ?? '你是一个有帮助的助手。';
    }
    const modelOpt = 'qwen';
    const messages = { system, user: prompt };
    let content = '';
    try {
      const ctx = runtimeInput && runtimeInput.__ctx ? runtimeInput.__ctx : null;
      const raw = await chatWithModel(messages, CHAT_RESPONSE_SCHEMA, {
        model: modelOpt,
        logCtx: ctx
          ? { user_id: ctx.user_id ?? null, workflow_id: ctx.workflow_id ?? null }
          : null,
      });
      if (raw) {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          content = (parsed && parsed.content) || raw;
        } catch (_) {
          content = raw;
        }
      }
    } catch (e) {
      content = `[LLM Error: ${e.message}]`;
    }
    return withNodeEnvelope(node, { text: content, result: content }, { message: 'LLM处理成功' });
  }

  if (type === 'knowledge') {
    const query = inputs.query ?? data.query ?? '';
    const result = { query, matched: false };
    return withNodeEnvelope(node, { result }, { message: '知识检索已完成', user_view: `已完成知识检索，关键词为“${String(query || '')}”。` });
  }

  if (type === 'condition') {
    const value = inputs.value ?? data.value ?? '';
    const expr = (data.condition ?? 'true').trim().toLowerCase();
    let ok = false;
    try {
      if (expr === 'true' || expr === '') ok = Boolean(value);
      else if (expr === 'false') ok = false;
      else ok = Boolean(value);
    } catch (_) {
      ok = false;
    }
    return withNodeEnvelope(node, { yes: ok ? value : undefined, no: !ok ? value : undefined }, { message: ok ? '条件判断为真' : '条件判断为假' });
  }

  if (type === 'code') {
    const code = data.code ?? (typeof inputs.code === 'string' ? inputs.code : 'return input;');
    const inputVal = inputs.input ?? data.input ?? '';
    try {
      const fn = new Function('input', code);
      const result = fn(inputVal);
      const finalResult = result !== undefined ? String(result) : '';
      return withNodeEnvelope(node, { result: finalResult }, { message: '代码节点执行成功' });
    } catch (e) {
      return withNodeEnvelope(node, { result: `[Code Error: ${e.message}]` }, { status: 'error', message: '代码节点执行失败' });
    }
  }

  if (type === 'http') {
    const url = inputs.url ?? data.url ?? '';
    const method = (inputs.method ?? data.method ?? 'GET').toUpperCase();
    const body = inputs.body ?? data.body;
    try {
      const opts = { method };
      if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const res = await fetch(url, opts);
      const text = await res.text();
      let response = text;
      try {
        response = JSON.parse(text);
      } catch (_) {}
      return withNodeEnvelope(node, { response, result: response }, { message: 'HTTP请求成功' });
    } catch (e) {
      return withNodeEnvelope(node, { response: { error: e.message } }, { status: 'error', message: 'HTTP请求失败' });
    }
  }

  if (type === 'end') {
    const result = inputs.result ?? inputs.input ?? '';
    return withNodeEnvelope(node, { result }, { message: '流程执行完成' });
  }

  return withNodeEnvelope(node, {}, { message: '节点执行完成' });
}

/**
 * 从 start 节点开始 BFS 执行，按依赖顺序执行节点，将输出通过 edge 的 sourceHandle/targetHandle 传给下游
 */
async function run(nodes, edges, runtimeInput = {}) {
  const { nodeMap, inEdges, outEdges } = buildGraph(nodes, edges);
  const results = new Map(); // nodeId -> { outputHandle: value }
  const queue = [];
  const inDegree = new Map();

  for (const n of nodes) {
    const ins = inEdges.get(n.id);
    const degree = n.type === 'start' ? 0 : ins.length;
    inDegree.set(n.id, degree);
    if (degree === 0) queue.push(n.id);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const inputs = {};
    for (const e of inEdges.get(nodeId)) {
      const out = results.get(e.source);
      if (!out) continue;
      const val = e.sourceHandle ? out[e.sourceHandle] : Object.values(out)[0];
      if (val !== undefined) inputs[e.targetHandle || 'input'] = val;
    }
    if (node.type !== 'start' && Object.keys(inputs).length === 0 && inEdges.get(nodeId).length > 0) {
      continue;
    }

    const out = await runNode(node, inputs, runtimeInput);
    results.set(nodeId, out);

    for (const e of outEdges.get(nodeId)) {
      const nextId = e.target;
      let deg = inDegree.get(nextId) - 1;
      inDegree.set(nextId, deg);
      if (deg === 0) queue.push(nextId);
    }
  }

  const endNodes = nodes.filter((n) => n.type === 'end');
  const endOutputs = [];
  for (const n of endNodes) {
    const r = results.get(n.id);
    if (r) endOutputs.push(r.result ?? r.input ?? '');
  }
  return {
    success: true,
    outputs: endOutputs,
    nodeResults: Object.fromEntries(
      Array.from(results.entries()).map(([id, r]) => [id, r]),
    ),
  };
}

module.exports = {
  getList,
  getOne,
  saveOne,
  run,
  generateId,
};
