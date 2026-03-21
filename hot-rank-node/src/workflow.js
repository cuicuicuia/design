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
    return { trigger: v };
  }

  if (type === 'llm') {
    let prompt = inputs.prompt ?? data.prompt ?? '';
    let system = inputs.system ?? data.system ?? '你是一个有帮助的助手。';
    const promptEmpty = !String(prompt || '').trim();
    const systemHasValue = Object.prototype.hasOwnProperty.call(inputs || {}, 'system') && String(inputs.system || '').trim();
    const dataPromptEmpty = !String(data.prompt || '').trim();
    if (promptEmpty && systemHasValue && dataPromptEmpty) {
      // 上游接到了 system 输入口，但用户期望把它当作对话输入使用时，做回退兼容
      prompt = inputs.system;
      system = data.system ?? '你是一个有帮助的助手。';
    }
    const modelOpt = data.model === 'gpt-4o' ? 'openai:gpt-4o' : (data.model || 'qwen');
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
    return { text: content };
  }

  if (type === 'knowledge') {
    const query = inputs.query ?? data.query ?? '';
    // 简化：无真实知识库时返回占位
    return { result: `[Knowledge: ${query}]` };
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
    return { yes: ok ? value : undefined, no: !ok ? value : undefined };
  }

  if (type === 'code') {
    const code = data.code ?? (typeof inputs.code === 'string' ? inputs.code : 'return input;');
    const inputVal = inputs.input ?? data.input ?? '';
    try {
      const fn = new Function('input', code);
      const result = fn(inputVal);
      return { result: result !== undefined ? String(result) : '' };
    } catch (e) {
      return { result: `[Code Error: ${e.message}]` };
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
      return { response };
    } catch (e) {
      return { response: { error: e.message } };
    }
  }

  if (type === 'end') {
    return { result: inputs.result ?? inputs.input ?? '' };
  }

  return {};
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
