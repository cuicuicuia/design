import { get } from '@/utils/request'

export interface AiCallLogItem {
  id: number
  user_id: number | null
  workflow_id: string | null
  model_name: string
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: string | number | null
  status: string
  duration_ms: number | null
  error_message: string | null
  created_at: string
}

export interface AiStatsTotals {
  calls: number
  success_calls: number
  failed_calls: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost: string | number
}

export interface AiStatsSeriesItem {
  day: string
  model_name: string
  calls: number
  success_calls: number
  failed_calls: number
  total_tokens: number
  cost: string | number
}

export interface ApiResp<T> {
  code: number
  msg: string
  data: T
}

export const getAiLogs = (params?: {
  limit?: number
  offset?: number
  status?: string
  model_name?: string
  workflow_id?: string
  from?: string
  to?: string
}): Promise<ApiResp<AiCallLogItem[]>> => {
  return get('/ai/logs', params)
}

export const getAiStats = (params?: {
  from?: string
  to?: string
}): Promise<ApiResp<{ from: string; to: string; totals: AiStatsTotals | null; series: AiStatsSeriesItem[] }>> => {
  return get('/ai/stats', params)
}

