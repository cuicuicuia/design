import { get, post } from '@/utils/request'

// 定义接口返回的数据类型
export interface HotItem {
  hot_label: string
  hot_url: string
  hot_value: number
}

export interface HotSection {
  name: string
  insert_time?: string
  data: HotItem[]
}

export interface HotRankResponse {
  code: number
  msg: string
  data: HotSection[]
}

// 黄历数据类型定义
export interface YellowCalendarData {
  gregorian_calendar: string
  lunar_calendar: string
  good_actions: string[]
  bad_actions: string[]
}

export interface YellowCalendarResponse {
  code: number
  msg: string
  data: YellowCalendarData
}

export interface MusicData {
  id: number
  title: string
  url: string
  cover: string
}

export interface MusicResponse {
  code: number
  msg: string
  data: MusicData[]
}

// 今日要闻类型定义
export interface TodayNewsItem {
  hot_label: string
  hot_url: string
  hot_value: number | null
  content: string
  hot_content: string
  hot_tag: string
}

export interface TodayTopNewsResponse {
  code: number
  msg: string
  data: TodayNewsItem[]
}

// 获取热门排行榜数据
export const getHotRank = (): Promise<HotRankResponse> => {
  return get<HotRankResponse>('/rank/hot')
}

// 获取黄历数据
export const getYellowCalendar = (): Promise<YellowCalendarResponse> => {
  return get<YellowCalendarResponse>('/yellowCalendar')
}

// 获取音乐数据
export const getMusic = (): Promise<MusicResponse> => {
  return get<MusicResponse>('/music')
}

// 获取今日要闻
export const getTodayTopNews = (): Promise<TodayTopNewsResponse> => {
  return get<TodayTopNewsResponse>('/todayTopNews')
}

// 刷新接口
export const refresh = () => {
  return get('/refresh')
}

// 千问 AI 聊天（带资讯上下文）
export interface ChatContext {
  title?: string
  url?: string
}

export interface ChatResponse {
  code: number
  msg: string
  data: { content: string } | null
}

export const postChat = (context: ChatContext | undefined, message: string): Promise<ChatResponse> => {
  return post<ChatResponse>('/chat', { context: context || undefined, message })
}

const getBaseURL = () => import.meta.env.VITE_API_BASE_URL || ''

/** 流式聊天：NDJSON 流，每行 { t: 'r'|'c', c: string }，onChunk 收到 { type: 'reasoning'|'content', chunk } */
export async function postChatStream(
  context: ChatContext | undefined,
  message: string,
  onChunk: (payload: { type: 'reasoning' | 'content'; chunk: string }) => void,
): Promise<void> {
  const baseURL = getBaseURL()
  const res = await fetch(`${baseURL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: context || undefined, message }),
  })
  if (!res.ok || !res.body) throw new Error(res.statusText || 'stream failed')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed) as { t?: string; c?: string }
          const type = obj.t === 'r' ? 'reasoning' : 'content'
          if (typeof obj.c === 'string') onChunk({ type, chunk: obj.c })
        } catch (_) {
          /* 忽略单行解析错误 */
        }
      }
    }
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer.trim()) as { t?: string; c?: string }
        const type = obj.t === 'r' ? 'reasoning' : 'content'
        if (typeof obj.c === 'string') onChunk({ type, chunk: obj.c })
      } catch (_) {}
    }
  } finally {
    reader.releaseLock()
  }
}

// ---------- 工作流 API ----------
export interface WorkflowListItem {
  id: string
  name: string
  organization_id?: number
  status?: string
  version?: number
  created_at?: string
}

export interface WorkflowDetail {
  id: string
  name: string
  nodes: unknown[]
  edges: unknown[]
  organization_id?: number
  status?: string
  version?: number
  created_at?: string
}

export interface WorkflowRunResult {
  success: boolean
  outputs: string[]
  nodeResults: Record<string, Record<string, unknown>>
  executionId?: number
  error?: string
}

export interface WorkflowRunStepResult {
  success: boolean
  done: boolean
  executionId: number
  currentNodeId?: string
  currentInput?: unknown
  currentOutput?: unknown
  cursor?: number
  total?: number
  outputs?: string[]
  nodeResults?: Record<string, Record<string, unknown>>
  error?: string
}

export interface WorkflowExecutionListItem {
  id: number
  workflow_id: string
  status: string
  started_at: string
  finished_at: string | null
}

export interface WorkflowExecutionNodeItem {
  id: number
  node_id: string
  status: string
  input: unknown
  output: unknown
  error_message: string | null
  started_at: string
  finished_at: string | null
}

export interface WorkflowExecutionDetail {
  id: number
  workflow_id: string
  status: string
  input_json: unknown
  output_json: unknown
  started_at: string
  finished_at: string | null
  nodes: WorkflowExecutionNodeItem[]
}

export const getWorkflowList = (): Promise<{ code: number; msg: string; data: WorkflowListItem[] }> =>
  get('/workflow/list')

export const getPublicWorkflowList = (limit = 200): Promise<{ code: number; msg: string; data: WorkflowListItem[] }> =>
  get('/workflow/public', { limit })

export const getWorkflow = (id: string): Promise<{ code: number; msg: string; data: WorkflowDetail | null }> =>
  get(`/workflow/${id}`)

export const saveWorkflow = (payload: {
  id?: string
  name: string
  status?: string
  nodes: unknown[]
  edges: unknown[]
}): Promise<{ code: number; msg: string; data: WorkflowDetail }> =>
  post('/workflow', payload)

export const runWorkflow = (payload: {
  workflowId?: string
  nodes?: unknown[]
  edges?: unknown[]
  inputs?: Record<string, string>
}): Promise<{ code: number; msg: string; data: WorkflowRunResult }> =>
  post('/workflow/run', payload)

export const runWorkflowStep = (payload: {
  workflowId: string
  executionId?: number
  inputs?: Record<string, string>
}): Promise<{ code: number; msg: string; data: WorkflowRunStepResult }> =>
  post('/workflow/run-step', payload)

export const getWorkflowExecutions = (workflowId: string, limit = 20): Promise<{ code: number; msg: string; data: WorkflowExecutionListItem[] }> =>
  get('/workflow/executions', { workflowId, limit })

export const getWorkflowExecution = (id: number): Promise<{ code: number; msg: string; data: WorkflowExecutionDetail | null }> =>
  get(`/workflow/executions/${id}`)
