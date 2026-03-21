const { config } = require('./config');
const { redis } = require('./redis');
const { insertAiCallLog } = require('./aiCallLog');
//  cd .\hot-rank-web\vue-ui\; pnpm run dev
// cd .\hot-rank-node\ ;npm start

const DEFAULT_PRICING = {
  // USD per 1K tokens (approx; can override via AI_PRICING_JSON)
  'openai:gpt-4o': { prompt_per_1k: 0.005, completion_per_1k: 0.015 },
  'openai:gpt-4o-mini': { prompt_per_1k: 0.00015, completion_per_1k: 0.0006 },
};

function getPricingTable() {
  const raw = config.ai && config.ai.pricingJson ? String(config.ai.pricingJson).trim() : '';
  if (!raw) return DEFAULT_PRICING;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PRICING, ...(parsed || {}) };
  } catch (_) {
    return DEFAULT_PRICING;
  }
}

function calcCostUSD(modelFullName, usage) {
  if (!usage) return null;
  const pricing = getPricingTable()[modelFullName];
  if (!pricing) return null;
  const p = usage.prompt_tokens;
  const c = usage.completion_tokens;
  if (Number.isFinite(p) && Number.isFinite(c)) {
    const promptRate = Number(pricing.prompt_per_1k);
    const completionRate = Number(pricing.completion_per_1k);
    if (!Number.isFinite(promptRate) || !Number.isFinite(completionRate)) return null;
    const cost = (p / 1000) * promptRate + (c / 1000) * completionRate;
    return Number.isFinite(cost) ? cost : null;
  }
  const t = usage.total_tokens;
  if (Number.isFinite(t) && Number.isFinite(Number(pricing.total_per_1k))) {
    const cost = (t / 1000) * Number(pricing.total_per_1k);
    return Number.isFinite(cost) ? cost : null;
  }
  return null;
}

function extractUsage(modelType, data) {
  if (!data) return null;
  if (modelType === 'openai' || modelType === 'qwen') {
    const u = data.usage;
    if (!u) return null;
    return {
      prompt_tokens: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null,
      completion_tokens: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null,
      total_tokens: Number.isFinite(u.total_tokens) ? u.total_tokens : null,
    };
  }
  if (modelType === 'gemini') {
    const u = data.usageMetadata || data.usage_metadata;
    if (!u) return null;
    const prompt = u.promptTokenCount ?? u.prompt_tokens ?? null;
    const completion = u.candidatesTokenCount ?? u.completion_tokens ?? null;
    const total = u.totalTokenCount ?? u.total_tokens ?? null;
    return {
      prompt_tokens: Number.isFinite(prompt) ? prompt : null,
      completion_tokens: Number.isFinite(completion) ? completion : null,
      total_tokens: Number.isFinite(total) ? total : null,
    };
  }
  return null;
}

async function safeRedisGet(key) {
  try {
    const p = redis.get(key);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 200));
    return await Promise.race([p, timeout]);
  } catch (e) {
    return null;
  }
}

async function chatWithModel(messages, responseSchema, options = {}) {
  const startedAt = Date.now();
  const logCtx = options.logCtx || null;
  let finalModelName = null;
  let finalModelType = null;
  let lastErrMsg = '';
  let err = Number.isFinite(options.retries) ? Math.max(1, Math.floor(options.retries)) : 3;
  while (err > 0) {
    let model = options.model != null ? options.model : await safeRedisGet('model');
    let modelName;
    let modelType;
    let url = config.ai.openaiUrl;
    let headers = {
      Authorization: `Bearer ${config.ai.openaiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (!model) {
      modelName = 'gpt-4o';
      modelType = 'openai';
    } else {
      const parts = String(model).split(':');
      modelType = parts[0];
      modelName = parts[1] || (modelType === 'qwen' ? 'qwen3.5-plus' : 'gpt-4o');
    }

    finalModelName = modelName;
    finalModelType = modelType;

    // 有些网关/供应商在启用 response_format(json*) 时要求 messages 中包含 "json" 字样
    const msg = messages && typeof messages === 'object' ? { ...messages } : { system: '', user: '' };
    const hasJsonWord =
      /json/i.test(String(msg.system || '')) || /json/i.test(String(msg.user || ''));

    let body;

    if (modelType === 'qwen') {
      url = `${config.ai.qwenBaseUrl}/chat/completions`;
      headers = {
        Authorization: `Bearer ${config.ai.qwenKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (!hasJsonWord) {
        msg.system = `${String(msg.system || '').trim()}\n\n请严格以 JSON 格式返回。`
      }
      const useSearch = options.enableSearch === true;
      const maxTokens = Number.isFinite(Number(options.maxTokens)) ? Number(options.maxTokens) : 1024;
      body = {
        model: modelName,
        messages: [
          { role: 'system', content: msg.system },
          { role: 'user', content: msg.user },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: Math.max(64, Math.min(4096, Math.floor(maxTokens))),
        enable_search: useSearch,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'hot_topic',
            strict: true,
            schema: responseSchema,
          },
        },
      };
      if (useSearch) {
        body.search_options = { search_strategy: 'turbo' };
      }
    } else if (modelType === 'gemini') {
      url = `${config.ai.geminiUrl}${modelName}:streamGenerateContent?alt=sse`;
      headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': config.ai.geminiKey || '',
      };
      body = {
        system_instruction: {
          parts: [{ text: msg.system }],
        },
        contents: [
          {
            parts: [{ text: msg.user }],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          response_json_schema: responseSchema,
        },
      };
    } else {
      if (!hasJsonWord) {
        msg.system = `${String(msg.system || '').trim()}\n\nRespond strictly in JSON.`
      }
      body = {
        model: modelName,
        messages: [
          {
            role: 'system',
            content: msg.system,
          },
          {
            role: 'user',
            content: msg.user,
          },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: 4096,
        top_p: 1.0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'hot_topic',
            strict: true,
            schema: responseSchema,
          },
        },
      };
    }

    try {
      const controller = new AbortController();
      const timeoutMs = Number(options.timeoutMs || 20000);
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!resp.ok) {
        let detail = '';
        try {
          const text = await resp.text();
          detail = text ? text.slice(0, 800) : '';
        } catch (_) {}
        err -= 1;
        lastErrMsg = `http_${resp.status}${detail ? `:${detail}` : ''}`;
        continue;
      }
      const data = await resp.json();
      if (modelType === 'openai' || modelType === 'qwen') {
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const usage = extractUsage(modelType, data);
          const duration_ms = Date.now() - startedAt;
          if (logCtx) {
            const modelFullName = `${modelType}:${modelName}`;
            void insertAiCallLog({
              user_id: logCtx.user_id ?? null,
              workflow_id: logCtx.workflow_id ?? null,
              model_name: modelFullName,
              prompt_tokens: usage?.prompt_tokens ?? null,
              completion_tokens: usage?.completion_tokens ?? null,
              total_tokens: usage?.total_tokens ?? null,
              cost: calcCostUSD(modelFullName, usage),
              status: 'success',
              duration_ms,
              error_message: null,
            });
          }
          return typeof content === 'string' ? content : JSON.stringify(content);
        }
      } else if (modelType === 'gemini') {
        const text =
          data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) {
          const usage = extractUsage(modelType, data);
          const duration_ms = Date.now() - startedAt;
          if (logCtx) {
            const modelFullName = `${modelType}:${modelName}`;
            void insertAiCallLog({
              user_id: logCtx.user_id ?? null,
              workflow_id: logCtx.workflow_id ?? null,
              model_name: modelFullName,
              prompt_tokens: usage?.prompt_tokens ?? null,
              completion_tokens: usage?.completion_tokens ?? null,
              total_tokens: usage?.total_tokens ?? null,
              cost: calcCostUSD(modelFullName, usage),
              status: 'success',
              duration_ms,
              error_message: null,
            });
          }
          return text;
        }
      }
      err -= 1;
      // 把模型返回体关键信息截断记录下来，便于排错
      try {
        const snippet = JSON.stringify(data).slice(0, 800);
        lastErrMsg = `no_content:${snippet}`;
      } catch (_) {
        lastErrMsg = 'no_content';
      }
    } catch (e) {
      console.error('fetch ai error', e);
      err -= 1;
      lastErrMsg = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch_error');
    }
  }

  // 最终失败：记录一次失败日志（不记录每次重试）
  if (logCtx) {
    const duration_ms = Date.now() - startedAt;
    const mn = finalModelType && finalModelName ? `${finalModelType}:${finalModelName}` : 'unknown';
    void insertAiCallLog({
      user_id: logCtx.user_id ?? null,
      workflow_id: logCtx.workflow_id ?? null,
      model_name: mn,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      cost: null,
      status: 'fail',
      duration_ms,
      error_message: lastErrMsg || 'unknown_error',
    });
  }
  if (options.throwOnFail) {
    const e = new Error(lastErrMsg || 'unknown_error');
    e.code = lastErrMsg || 'unknown_error';
    throw e;
  }
  return '';
}

/**
 * 流式调用：解析 SSE，yield { type: 'reasoning'|'content', chunk }。
 * 千问 enable_thinking 时 delta 含 reasoning_content 与 content，类似 DeepSeek 思考过程。
 */
async function* chatWithModelStream(messages, options = {}) {
  const startedAt = Date.now();
  const logCtx = options.logCtx || null;
  const model = await safeRedisGet('model');
  let modelName;
  let modelType;
  let url = config.ai.openaiUrl;
  let headers = {
    Authorization: `Bearer ${config.ai.openaiKey}`,
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };

  if (!model) {
    modelName = 'qwen3.5-plus';
    modelType = 'qwen';
  } else {
    const parts = String(model).split(':');
    modelType = parts[0];
    modelName = parts[1] || (modelType === 'qwen' ? 'qwen3.5-plus' : 'gpt-4o');
  }

  let body;
  if (modelType === 'qwen') {
    url = `${config.ai.qwenBaseUrl}/chat/completions`;
    headers = {
      Authorization: `Bearer ${config.ai.qwenKey}`,
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    };
    body = {
      model: modelName,
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
      stream: true,
      temperature: 0.1,
      max_tokens: 4096,
      enable_search: true,
      search_options: { search_strategy: 'agent_max' },
      enable_thinking: true,
    };
  } else if (modelType === 'openai') {
    body = {
      model: modelName,
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
      stream: true,
      temperature: 0.1,
      max_tokens: 4096,
    };
  } else {
    // gemini 流式格式不同，暂不实现 stream，调用方可用 chatWithModel
    return;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    if (logCtx) {
      void insertAiCallLog({
        user_id: logCtx.user_id ?? null,
        workflow_id: logCtx.workflow_id ?? null,
        model_name: `${modelType}:${modelName}`,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        cost: null,
        status: 'fail',
        duration_ms: Date.now() - startedAt,
        error_message: `http_${resp.status}`,
      });
    }
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const s = line.startsWith('data: ') ? line.slice(6).trim() : '';
        if (s === '' || s === '[DONE]') continue;
        try {
          const data = JSON.parse(s);
          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;
          if (modelType === 'qwen') {
            const reasoning = delta.reasoning_content;
            const content = delta.content;
            if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', chunk: reasoning };
            if (typeof content === 'string' && content) yield { type: 'content', chunk: content };
          } else {
            const content = delta.content;
            if (typeof content === 'string' && content) yield { type: 'content', chunk: content };
          }
        } catch (_) {
          // 忽略单行解析错误
        }
      }
    }
    if (buffer.trim()) {
      const s = buffer.startsWith('data: ') ? buffer.slice(6).trim() : '';
      if (s && s !== '[DONE]') {
        try {
          const data = JSON.parse(s);
          const delta = data.choices?.[0]?.delta;
          if (!delta) return;
          if (modelType === 'qwen') {
            const reasoning = delta.reasoning_content;
            const content = delta.content;
            if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', chunk: reasoning };
            if (typeof content === 'string' && content) yield { type: 'content', chunk: content };
          } else {
            const content = delta.content;
            if (typeof content === 'string' && content) yield { type: 'content', chunk: content };
          }
        } catch (_) {}
      }
    }
  } finally {
    reader.releaseLock();
    if (logCtx) {
      void insertAiCallLog({
        user_id: logCtx.user_id ?? null,
        workflow_id: logCtx.workflow_id ?? null,
        model_name: `${modelType}:${modelName}`,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        cost: null,
        status: 'success',
        duration_ms: Date.now() - startedAt,
        error_message: null,
      });
    }
  }
}

module.exports = { chatWithModel, chatWithModelStream };

