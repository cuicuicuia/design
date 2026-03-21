/**
 * 节点类型定义：输入/输出变量（对应 Handle id），用于连线与执行
 */
export interface NodePort {
  id: string
  label: string
  type?: 'string' | 'number' | 'object' | 'any'
}

export interface NodeTypeDef {
  type: string
  label: string
  category: string
  inputs: NodePort[]
  outputs: NodePort[]
  /** 右侧配置面板字段 */
  configFields?: { key: string; label: string; field: 'text' | 'textarea' | 'select'; options?: string[] }[]
}

export const NODE_DEFINITIONS: NodeTypeDef[] = [
  {
    type: 'start',
    label: '开始',
    category: '触发器',
    inputs: [],
    outputs: [{ id: 'trigger', label: '触发', type: 'string' }],
    configFields: [{ key: 'user_input', label: '默认输入', field: 'textarea' }],
  },
  {
    type: 'llm',
    label: 'LLM 大模型',
    category: 'AI',
    inputs: [
      { id: 'prompt', label: '提示词', type: 'string' },
      { id: 'system', label: '系统提示', type: 'string' },
    ],
    outputs: [{ id: 'text', label: '回复', type: 'string' }],
    configFields: [
      { key: 'mode', label: '模式', field: 'select', options: ['chat', 'executor_plan'] },
      { key: 'model', label: '模型', field: 'select', options: ['qwen', 'gpt-4o'] },
      { key: 'system', label: '系统提示词', field: 'textarea' },
      { key: 'prompt', label: '默认提示', field: 'textarea' },
      { key: 'executor_template', label: '执行器模板(可选)', field: 'textarea' },
      { key: 'timeout_ms', label: '超时(ms,默认60000)', field: 'text' },
      { key: 'max_tokens', label: '最大Token(默认1024)', field: 'text' },
      { key: 'retries', label: '重试次数(默认1)', field: 'text' },
      { key: 'enable_search', label: '联网搜索', field: 'select', options: ['false', 'true'] },
    ],
  },
  {
    type: 'knowledge',
    label: '知识库',
    category: 'AI',
    inputs: [{ id: 'query', label: '查询', type: 'string' }],
    outputs: [{ id: 'result', label: '检索结果', type: 'string' }],
    configFields: [{ key: 'query', label: '默认查询', field: 'text' }],
  },
  {
    type: 'condition',
    label: '条件分支',
    category: '逻辑',
    inputs: [{ id: 'value', label: '输入值', type: 'any' }],
    outputs: [
      { id: 'yes', label: '是', type: 'any' },
      { id: 'no', label: '否', type: 'any' },
    ],
    configFields: [{ key: 'condition', label: '条件表达式', field: 'text' }],
  },
  {
    type: 'code',
    label: '代码',
    category: '工具',
    inputs: [
      { id: 'input', label: '输入', type: 'any' },
      { id: 'code', label: '代码', type: 'string' },
    ],
    outputs: [{ id: 'result', label: '结果', type: 'string' }],
    configFields: [{ key: 'code', label: '代码体 (function body, 参数 input)', field: 'textarea' }],
  },
  {
    type: 'http',
    label: 'HTTP 请求',
    category: '工具',
    inputs: [
      { id: 'url', label: 'URL', type: 'string' },
      { id: 'method', label: '方法', type: 'string' },
      { id: 'body', label: '请求体', type: 'string' },
    ],
    outputs: [{ id: 'response', label: '响应', type: 'object' }],
    configFields: [
      { key: 'url', label: 'URL', field: 'text' },
      { key: 'method', label: '方法', field: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'body', label: '请求体 JSON', field: 'textarea' },
    ],
  },
  {
    type: 'end',
    label: '结束',
    category: '结束',
    inputs: [{ id: 'result', label: '结果', type: 'any' }],
    outputs: [],
    configFields: [],
  },
]

export function getNodeDef(type: string): NodeTypeDef | undefined {
  return NODE_DEFINITIONS.find((d) => d.type === type)
}
