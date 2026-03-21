<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAiLogs, getAiStats, type AiCallLogItem, type AiStatsTotals, type AiStatsSeriesItem } from '@/api/ai'

const router = useRouter()

const loading = ref(false)
const error = ref<string | null>(null)

type StatsData = { from: string; to: string; totals: AiStatsTotals | null; series: AiStatsSeriesItem[] }
const stats = ref<StatsData | null>(null)
const logs = ref<AiCallLogItem[]>([])

const totalCalls = computed(() => Number(stats.value?.totals?.calls || 0))
const totalTokens = computed(() => Number(stats.value?.totals?.total_tokens || 0))
const successCalls = computed(() => Number(stats.value?.totals?.success_calls || 0))
const failedCalls = computed(() => Number(stats.value?.totals?.failed_calls || 0))
const successRate = computed(() => {
  const c = totalCalls.value
  if (!c) return 0
  return Math.round((successCalls.value / c) * 1000) / 10
})

function goBack() {
  router.push('/')
}

async function fetchAll() {
  loading.value = true
  error.value = null
  try {
    const [s, l] = await Promise.all([
      getAiStats(),
      getAiLogs({ limit: 50 }),
    ])
    if (s.code !== 200) throw new Error(s.msg || 'stats failed')
    if (l.code !== 200) throw new Error(l.msg || 'logs failed')
    stats.value = s.data
    logs.value = Array.isArray(l.data) ? l.data : []
  } catch (e: unknown) {
    const err = e as { response?: { data?: { msg?: unknown } }; message?: unknown }
    const msg = err?.response?.data?.msg || err?.message || '加载失败'
    error.value = String(msg)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchAll()
})
</script>

<template>
  <main class="p-10 font-mono text-black bg-white dark:bg-gray-900 dark:text-white mx-auto max-w-6xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">&gt; AI 调用监控</h1>
      <div class="space-x-2">
        <button
          class="px-3 py-2 text-xs border hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
          @click="fetchAll"
        >
          刷新
        </button>
        <button
          class="px-3 py-2 text-xs bg-black text-white hover:bg-gray-800 dark:bg-gray-200 dark:text-black dark:hover:bg-gray-300"
          @click="goBack"
        >
          返回首页
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-gray-600 dark:text-gray-400">加载中...</div>
    <div v-else-if="error" class="text-sm text-red-600">
      {{ error }}
      <div class="mt-2 text-xs text-gray-600 dark:text-gray-400">
        若提示 401，请先在首页右上角登录后再进入本页。
      </div>
    </div>

    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div class="border dark:border-gray-700 p-4 rounded">
          <div class="text-xs text-gray-500 dark:text-gray-400">近 7 天调用次数</div>
          <div class="text-xl font-bold mt-2">{{ totalCalls }}</div>
        </div>
        <div class="border dark:border-gray-700 p-4 rounded">
          <div class="text-xs text-gray-500 dark:text-gray-400">成功率</div>
          <div class="text-xl font-bold mt-2">{{ successRate }}%</div>
        </div>
        <div class="border dark:border-gray-700 p-4 rounded">
          <div class="text-xs text-gray-500 dark:text-gray-400">失败次数</div>
          <div class="text-xl font-bold mt-2">{{ failedCalls }}</div>
        </div>
        <div class="border dark:border-gray-700 p-4 rounded">
          <div class="text-xs text-gray-500 dark:text-gray-400">Token 总量</div>
          <div class="text-xl font-bold mt-2">{{ totalTokens }}</div>
        </div>
      </div>

      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-bold">&gt; 最近 50 条调用日志</h2>
        <div class="text-xs text-gray-500 dark:text-gray-400">
          cost 字段当前为预留（后端可配置价格表后计算）
        </div>
      </div>

      <div class="overflow-x-auto border dark:border-gray-700 rounded">
        <table class="min-w-full text-xs">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th class="text-left p-2">时间</th>
              <th class="text-left p-2">模型</th>
              <th class="text-left p-2">workflow</th>
              <th class="text-right p-2">tokens</th>
              <th class="text-right p-2">耗时(ms)</th>
              <th class="text-left p-2">状态</th>
              <th class="text-left p-2">错误</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in logs"
              :key="item.id"
              class="border-t dark:border-gray-700"
            >
              <td class="p-2 whitespace-nowrap">{{ item.created_at }}</td>
              <td class="p-2 whitespace-nowrap">{{ item.model_name }}</td>
              <td class="p-2 whitespace-nowrap">{{ item.workflow_id || '-' }}</td>
              <td class="p-2 text-right whitespace-nowrap">{{ item.total_tokens ?? '-' }}</td>
              <td class="p-2 text-right whitespace-nowrap">{{ item.duration_ms ?? '-' }}</td>
              <td class="p-2 whitespace-nowrap">
                <span
                  class="px-2 py-0.5 rounded border"
                  :class="item.status === 'success'
                    ? 'border-green-500 text-green-700 dark:text-green-400'
                    : 'border-red-500 text-red-700 dark:text-red-400'"
                >
                  {{ item.status }}
                </span>
              </td>
              <td class="p-2 max-w-[360px] truncate" :title="item.error_message || ''">
                {{ item.error_message || '-' }}
              </td>
            </tr>
            <tr v-if="logs.length === 0">
              <td class="p-4 text-gray-500 dark:text-gray-400" colspan="7">暂无日志</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </main>
</template>

