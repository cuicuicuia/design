<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getPublicWorkflowList, getWorkflowList, type WorkflowListItem } from '@/api/hotRank'
import { ArrowLeftIcon, PlusIcon } from '@heroicons/vue/16/solid'

const router = useRouter()

const loading = ref(false)
const authError = ref<string | null>(null)
const items = ref<WorkflowListItem[]>([])
const keyword = ref('')
const tab = ref<'mine' | 'public'>('mine')

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return items.value
  return items.value.filter((w) => String(w.name || '').toLowerCase().includes(k) || String(w.id || '').toLowerCase().includes(k))
})

async function load() {
  loading.value = true
  try {
    const res = tab.value === 'mine' ? await getWorkflowList() : await getPublicWorkflowList()
    if (res.code === 200) {
      items.value = Array.isArray(res.data) ? res.data : []
      authError.value = null
    }
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { msg?: unknown } } }
    const msg = err?.response?.data?.msg
    if (err?.response?.status === 401) authError.value = (typeof msg === 'string' ? msg : null) || '请先登录后查看工作流列表'
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.push('/')
}

function openWorkflow(id: string) {
  router.push({ path: '/workflow', query: { id } })
}

function createWorkflow() {
  router.push({ path: '/workflow' })
}

onMounted(load)

function switchTab(next: 'mine' | 'public') {
  tab.value = next
  load()
}
</script>

<template>
  <div class="min-h-screen bg-[#0b0f14] text-gray-100">
    <header class="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0b0f14]/80 backdrop-blur-sm sticky top-0 z-10">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-white/5 transition-colors"
          title="返回首页"
          @click="goBack"
        >
          <ArrowLeftIcon class="w-4 h-4" />
        </button>
        <div class="text-sm font-medium">工作流列表</div>
        <div class="ml-3 flex items-center gap-1 bg-white/5 rounded-md p-0.5">
          <button
            type="button"
            class="px-2.5 py-1 text-[11px] rounded"
            :class="tab === 'mine' ? 'bg-white/10 text-gray-100' : 'text-gray-400 hover:text-gray-200'"
            @click="switchTab('mine')"
          >
            我的
          </button>
          <button
            type="button"
            class="px-2.5 py-1 text-[11px] rounded"
            :class="tab === 'public' ? 'bg-white/10 text-gray-100' : 'text-gray-400 hover:text-gray-200'"
            @click="switchTab('public')"
          >
            公共库
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="keyword"
          type="text"
          class="w-56 px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100 placeholder:text-gray-500"
          placeholder="搜索名称或 id"
        />
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-black bg-gray-100 hover:bg-gray-200 transition-colors"
          @click="createWorkflow"
        >
          <PlusIcon class="w-4 h-4" />
          新建
        </button>
      </div>
    </header>

    <div v-if="authError" class="p-6">
      <div class="max-w-xl border border-white/10 rounded-lg bg-[#0f141b] p-5">
        <div class="text-sm font-medium mb-1">无权限</div>
        <div class="text-xs text-gray-400">{{ authError }}</div>
        <div class="mt-4">
          <button class="px-3 py-2 text-xs bg-gray-100 text-black hover:bg-gray-200 rounded-md" @click="goBack">
            返回首页登录
          </button>
        </div>
      </div>
    </div>

    <div v-else class="p-6">
      <div v-if="loading" class="text-xs text-gray-500">加载中…</div>
      <div v-else-if="filtered.length === 0" class="text-xs text-gray-500">
        暂无工作流。点击右上角「新建」创建一个。
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <button
          v-for="w in filtered"
          :key="w.id"
          class="text-left border border-white/10 hover:border-white/20 bg-[#0f141b] hover:bg-[#121a23] rounded-lg p-4 transition-colors"
          @click="openWorkflow(w.id)"
        >
          <div class="text-sm font-medium text-gray-100 truncate">{{ w.name || '未命名工作流' }}</div>
          <div class="mt-1 text-[11px] text-gray-500 truncate">id: {{ w.id }}</div>
          <div class="mt-3 flex items-center gap-2 text-[11px] text-gray-500">
            <span v-if="w.status">status: {{ w.status }}</span>
            <span v-if="w.version">v{{ w.version }}</span>
            <span v-if="w.created_at">created: {{ w.created_at }}</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

