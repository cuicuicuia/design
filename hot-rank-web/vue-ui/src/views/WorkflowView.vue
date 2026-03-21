<script setup lang="ts">
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { ref, computed, markRaw, watch, onMounted, onBeforeUnmount, type Component } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  VueFlow,
  type Node,
  type Edge,
  type Connection,
} from '@vue-flow/core'
import { Background as FlowBackground } from '@vue-flow/background'
import { Controls as FlowControls } from '@vue-flow/controls'
import StartNode from './workflow/nodes/StartNode.vue'
import LLMNode from './workflow/nodes/LLMNode.vue'
import KnowledgeNode from './workflow/nodes/KnowledgeNode.vue'
import ConditionNode from './workflow/nodes/ConditionNode.vue'
import CodeNode from './workflow/nodes/CodeNode.vue'
import HttpNode from './workflow/nodes/HttpNode.vue'
import EndNode from './workflow/nodes/EndNode.vue'
import { NODE_DEFINITIONS, getNodeDef } from './workflow/nodeDefs'
import {
  getWorkflow,
  saveWorkflow,
  runWorkflowStep,
  getWorkflowExecution,
  type WorkflowDetail,
  type WorkflowRunResult,
  type WorkflowRunStepResult,
  type WorkflowExecutionDetail,
} from '@/api/hotRank'
import { ArrowLeftIcon, XMarkIcon } from '@heroicons/vue/16/solid'

const router = useRouter()
const route = useRoute()

type ValidationIssue = { level: 'error' | 'warn'; message: string }
type NodeData = Record<string, unknown>

const nodeTypes: Record<string, Component> = {
  start: markRaw(StartNode) as unknown as Component,
  llm: markRaw(LLMNode) as unknown as Component,
  knowledge: markRaw(KnowledgeNode) as unknown as Component,
  condition: markRaw(ConditionNode) as unknown as Component,
  code: markRaw(CodeNode) as unknown as Component,
  http: markRaw(HttpNode) as unknown as Component,
  end: markRaw(EndNode) as unknown as Component,
}

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const flowWrapperRef = ref<HTMLElement | null>(null)

const workflowId = ref<string | null>(null)
const workflowName = ref('未命名工作流')
const workflowStatus = ref<'active' | 'draft' | 'public'>('active')
const selectedNode = ref<Node | null>(null)
const selectedEdge = ref<Edge | null>(null)
const addPosition = ref({ x: 200, y: 100 })

const paletteByCategory = computed(() => {
  const map = new Map<string, { type: string; label: string }[]>()
  NODE_DEFINITIONS.forEach((item) => {
    if (!map.has(item.category)) map.set(item.category, [])
    map.get(item.category)!.push({ type: item.type, label: item.label })
  })
  return map
})

const selectedNodeDef = computed(() =>
  selectedNode.value ? getNodeDef(selectedNode.value.type as string) : null,
)

const configForm = ref<Record<string, string>>({})
const autoApplyTimer = ref<number | null>(null)
watch(selectedNode, (n) => {
  if (!n) {
    configForm.value = {}
    return
  }
  const d = n.data as Record<string, string>
  configForm.value = { ...(d || {}) }
}, { immediate: true })

watch(configForm, () => {
  // Dify 风格：属性修改即时生效（防止忘记点“应用”导致运行输入为空）
  if (!selectedNode.value) return
  if (autoApplyTimer.value) window.clearTimeout(autoApplyTimer.value)
  autoApplyTimer.value = window.setTimeout(() => {
    saveNodeConfig()
  }, 300)
}, { deep: true })

const saveLoading = ref(false)
const runResult = ref<WorkflowRunResult | null>(null)
const runInput = ref('')
const lastRunUserInput = ref('')
const stepExecutionId = ref<number | null>(null)
const stepDone = ref(false)
const stepLoading = ref(false)
const stepUserInput = ref('')
const autoNextTimer = ref<number | null>(null)
const executionDetail = ref<WorkflowExecutionDetail | null>(null)
const executionDetailLoading = ref(false)
const authError = ref<string | null>(null)

const rightTab = ref<'props' | 'console'>('props')
const dirty = ref(false)
const validationIssues = ref<ValidationIssue[]>([])
const suppressDirty = ref(false)

const showGrid = ref(true)
const gridGap = ref(28)
const snapToGrid = ref(false)
const consoleCollapsed = ref(false)
const assistantOpen = ref(false)

const executionProgress = computed(() => {
  const ex = executionDetail.value
  if (!ex) return null
  const finishedNodes = ex.nodes.length
  const last = finishedNodes > 0 ? ex.nodes[finishedNodes - 1] : null
  return { finishedNodes, last }
})

const assistantSuggestion = computed(() => {
  const ex = executionDetail.value
  const lastErrNode = ex?.nodes?.find((n) => n.status === 'fail' && n.error_message)
  const rawErr = String(lastErrNode?.error_message || runResult.value?.error || '')
  const msg = rawErr.toLowerCase()
  if (!rawErr) return '状态正常：可继续观察每个节点 input/output 的递进变化。'
  if (msg.includes('empty prompt')) return '建议：将上游输出连接到 LLM 的 prompt 端口，或在节点里填写默认 prompt。'
  if (msg.includes('timeout') || msg.includes('aborterror')) return '建议：提高 timeout_ms 到 90000，并先关闭 enable_search 以降低延迟。'
  if (msg.includes('http_401') || msg.includes('http_403')) return '建议：检查 API Key、模型权限以及环境变量是否生效并重启后端。'
  if (msg.includes('http_404')) return '建议：检查 API URL/base_url 路径，确认是否指向正确的模型接口。'
  if (msg.includes('http_429')) return '建议：触发限流，降低并发或重试频率，稍后重试。'
  return `建议：查看失败节点日志并修复：${rawErr.slice(0, 120)}`
})

function applyExecutionHighlight() {
  const ex = executionDetail.value
  const statusMap = new Map<string, string>()
  if (ex && Array.isArray(ex.nodes)) {
    ex.nodes.forEach((n) => statusMap.set(String(n.node_id), String(n.status)))
  }

  nodes.value.forEach((n) => {
    const s = statusMap.get(String(n.id))
    let cls = 'magic-node'
    if (s === 'success') cls = 'exec-success'
    else if (s === 'running') cls = 'exec-running'
    else if (s === 'fail') cls = 'exec-fail'
    ;(n as unknown as { class?: string }).class = `magic-node ${cls}`
  })

  edges.value.forEach((e) => {
    const sourceStatus = statusMap.get(String(e.source))
    const targetStatus = statusMap.get(String(e.target))
    let cls = ''
    if (sourceStatus === 'success' && targetStatus === 'running') cls = 'exec-edge-active'
    else if (sourceStatus === 'success' && targetStatus === 'success') cls = 'exec-edge-done'
    else if (sourceStatus === 'fail' || targetStatus === 'fail') cls = 'exec-edge-fail'
    ;(e as unknown as { class?: string }).class = cls
  })
}

watch(executionDetail, () => {
  applyExecutionHighlight()
})

let nodeId = 0
function nextId() {
  return `node_${++nodeId}`
}

function addNode(type: string, position?: { x: number; y: number }) {
  const pos = position ?? { ...addPosition.value }
  const id = nextId()
  nodes.value = [
    ...nodes.value,
    {
      id,
      type: type as keyof typeof nodeTypes,
      position: pos,
      data: {},
    },
  ]
  addPosition.value = { x: pos.x + 40, y: pos.y + 60 }
  dirty.value = true
  return id
}

function onDragStart(e: DragEvent, type: string) {
  if (e.dataTransfer) {
    e.dataTransfer.setData('application/vueflow-node-type', type)
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const type = e.dataTransfer?.getData('application/vueflow-node-type')
  if (!type) return
  const el = flowWrapperRef.value
  let position = addPosition.value
  if (el) {
    const rect = el.getBoundingClientRect()
    position = { x: e.clientX - rect.left - 80, y: e.clientY - rect.top - 40 }
  }
  addNode(type, position)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onPaneClick() {
  selectedNode.value = null
  selectedEdge.value = null
}

function onNodeClick(e: { node?: Node } | MouseEvent, node?: Node) {
  selectedNode.value = (node ?? (e as { node?: Node }).node) ?? null
  selectedEdge.value = null
  rightTab.value = 'props'
}

function onConnect(params: Connection) {
  const id = `e${params.source}-${params.sourceHandle ?? 'a'}-${params.target}-${params.targetHandle ?? 'a'}`
  edges.value = [...edges.value, { ...params, id, type: 'default' }]
  dirty.value = true
}

function saveNodeConfig() {
  const n = selectedNode.value
  if (!n) return
  const idx = nodes.value.findIndex((x) => x.id === n.id)
  if (idx < 0) return
  const next = [...nodes.value]
  next[idx] = { ...next[idx], data: { ...(next[idx].data as object), ...configForm.value } }
  nodes.value = next
  selectedNode.value = next[idx]
  dirty.value = true
}

async function loadWorkflow(id: string) {
  try {
    suppressDirty.value = true
    const res = await getWorkflow(id)
    if (res.code === 200 && res.data) {
      const w = res.data as WorkflowDetail
      workflowId.value = w.id
      workflowName.value = w.name || '未命名工作流'
      workflowStatus.value = w.status === 'public' ? 'public' : (w.status === 'draft' ? 'draft' : 'active')
      nodes.value = (w.nodes || []) as Node[]
      edges.value = (w.edges || []) as Edge[]
      authError.value = null
      dirty.value = false
    }
  } catch (e) {
    console.error('Load workflow error', e)
    const err = e as { response?: { status?: number; data?: { msg?: unknown } } }
    const msg = err?.response?.data?.msg
    if (err?.response?.status === 401) authError.value = (typeof msg === 'string' ? msg : null) || '请先登录后使用工作流'
  } finally {
    // 延迟一帧，避免 watcher 读到 load 期间的变化
    queueMicrotask(() => { suppressDirty.value = false })
  }
}

onMounted(() => {
  const id = route.query.id as string
  if (id) loadWorkflow(id)
})

watch([nodes, edges, workflowName], () => {
  if (suppressDirty.value) return
  // 有内容变化才标脏；新建未保存的工作流也要标脏
  if (nodes.value.length || edges.value.length || workflowName.value) dirty.value = true
}, { deep: true })

function onEdgeClick(e: { edge?: Edge } | MouseEvent, edge?: Edge) {
  selectedEdge.value = (edge ?? (e as { edge?: Edge }).edge) ?? null
  selectedNode.value = null
  rightTab.value = 'props'
}

function validateWorkflow(): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const startNodes = nodes.value.filter((n) => n.type === 'start')
  const endNodes = nodes.value.filter((n) => n.type === 'end')
  if (startNodes.length === 0) issues.push({ level: 'error', message: '缺少「开始」节点' })
  if (startNodes.length > 1) issues.push({ level: 'error', message: '「开始」节点只能有一个' })
  if (endNodes.length === 0) issues.push({ level: 'warn', message: '缺少「结束」节点（可运行但不推荐）' })

  const nodeMap = new Map(nodes.value.map((n) => [n.id, n]))
  const inCount = new Map<string, number>()
  const outCount = new Map<string, number>()
  nodes.value.forEach((n) => { inCount.set(n.id, 0); outCount.set(n.id, 0) })

  for (const e of edges.value) {
    if (!e.source || !e.target) continue
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) {
      issues.push({ level: 'error', message: `存在无效连线（节点不存在）：${e.id}` })
      continue
    }
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1)
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1)

    const sNode = nodeMap.get(e.source)!
    const tNode = nodeMap.get(e.target)!
    const sDef = getNodeDef(sNode.type as string)
    const tDef = getNodeDef(tNode.type as string)
    const sOk = !e.sourceHandle || !!sDef?.outputs?.some((p) => p.id === e.sourceHandle)
    const tOk = !e.targetHandle || !!tDef?.inputs?.some((p) => p.id === e.targetHandle)
    if (!sOk) issues.push({ level: 'error', message: `连线 sourceHandle 不合法：${e.id}` })
    if (!tOk) issues.push({ level: 'error', message: `连线 targetHandle 不合法：${e.id}` })
  }

  for (const n of nodes.value) {
    if (n.type !== 'start' && (inCount.get(n.id) ?? 0) === 0) {
      const label = (n.data as NodeData | undefined)?.label
      issues.push({ level: 'warn', message: `节点「${(typeof label === 'string' && label) || n.type}」没有输入连线` })
    }
    if (n.type !== 'end' && (outCount.get(n.id) ?? 0) === 0) {
      const label = (n.data as NodeData | undefined)?.label
      issues.push({ level: 'warn', message: `节点「${(typeof label === 'string' && label) || n.type}」没有输出连线` })
    }
  }

  return issues
}

async function doSave() {
  validationIssues.value = validateWorkflow()
  if (validationIssues.value.some((x) => x.level === 'error')) {
    rightTab.value = 'console'
    return
  }
  saveLoading.value = true
  try {
    const res = await saveWorkflow({
      id: workflowId.value || undefined,
      name: workflowName.value,
      status: workflowStatus.value,
      nodes: nodes.value,
      edges: edges.value,
    })
    if (res.code === 200 && res.data) {
      workflowId.value = res.data.id
      if (!route.query.id) {
        router.replace({ path: '/workflow', query: { id: res.data.id } })
      }
      authError.value = null
      dirty.value = false
    }
  } catch (e) {
    console.error('Save workflow error', e)
    const err = e as { response?: { status?: number; data?: { msg?: unknown } } }
    const msg = err?.response?.data?.msg
    if (err?.response?.status === 401) authError.value = (typeof msg === 'string' ? msg : null) || '请先登录后使用工作流'
  } finally {
    saveLoading.value = false
  }
}

async function loadExecutionDetail(id: number) {
  executionDetailLoading.value = true
  try {
    const res = await getWorkflowExecution(id)
    if (res.code === 200) executionDetail.value = res.data
  } catch (e) {
    console.error('Load execution error', e)
  } finally {
    executionDetailLoading.value = false
  }
}

// 逐节点执行：默认走 stepStart/stepNext（无需一键运行/轮询）

function getUserInputToSend(): { ok: true; value: string } | { ok: false; reason: string } {
  const start = nodes.value.find((n) => n.type === 'start')
  const d = (start?.data as NodeData | undefined) || {}
  const fallback =
    (typeof d.user_input === 'string' && d.user_input.trim()) ||
    (typeof d.input === 'string' && d.input.trim()) ||
    ''
  const userInputToSend = runInput.value.trim() || fallback
  if (!userInputToSend) {
    return { ok: false, reason: '运行输入为空：请在右侧控制台填写 user_input，或在「开始」节点里填写默认输入' }
  }
  return { ok: true, value: userInputToSend }
}

async function stepStart() {
  if (!workflowId.value) {
    validationIssues.value = [{ level: 'error', message: '请先保存工作流后再逐节点运行' }]
    rightTab.value = 'console'
    return
  }
  validationIssues.value = validateWorkflow()
  if (validationIssues.value.some((x) => x.level === 'error')) {
    rightTab.value = 'console'
    return
  }

  const ui = getUserInputToSend()
  if (!ui.ok) {
    validationIssues.value = [{ level: 'error', message: ui.reason }]
    rightTab.value = 'console'
    return
  }

  stepLoading.value = true
  stepDone.value = false
  stepUserInput.value = ui.value
  stepExecutionId.value = null
  runResult.value = null
  executionDetail.value = null

  try {
    const res = await runWorkflowStep({ workflowId: workflowId.value, inputs: { user_input: ui.value } })
    if (res.code === 200 && res.data) {
      const data = res.data as WorkflowRunStepResult
      stepExecutionId.value = data.executionId
      stepDone.value = data.done
      lastRunUserInput.value = ui.value
      await loadExecutionDetail(data.executionId)
      if (data.done) {
        runResult.value = {
          success: true,
          outputs: data.outputs || [],
          nodeResults: (data.nodeResults || {}) as Record<string, Record<string, unknown>>,
          executionId: data.executionId,
        }
      } else {
        runResult.value = { success: true, outputs: [], nodeResults: {}, executionId: data.executionId }
      }
      authError.value = null
      scheduleAutoNext()
    }
  } catch (e) {
    console.error('Step run error', e)
    const msg = e instanceof Error ? e.message : 'step run failed'
    runResult.value = { success: false, outputs: [], nodeResults: {}, error: msg }
  } finally {
    stepLoading.value = false
  }
}

async function stepNext() {
  if (!workflowId.value || !stepExecutionId.value) return
  if (stepDone.value || stepLoading.value) return

  stepLoading.value = true
  try {
    const res = await runWorkflowStep({ workflowId: workflowId.value, executionId: stepExecutionId.value, inputs: { user_input: stepUserInput.value } })
    if (res.code === 200 && res.data) {
      const data = res.data as WorkflowRunStepResult
      stepDone.value = data.done
      await loadExecutionDetail(data.executionId)
      if (data.done) {
        runResult.value = {
          success: true,
          outputs: data.outputs || [],
          nodeResults: (data.nodeResults || {}) as Record<string, Record<string, unknown>>,
          executionId: data.executionId,
        }
      } else {
        runResult.value = { success: true, outputs: [], nodeResults: {}, executionId: data.executionId }
      }
      authError.value = null
      scheduleAutoNext()
    }
  } catch (e) {
    console.error('Step next error', e)
    const msg = e instanceof Error ? e.message : 'step next failed'
    runResult.value = { success: false, outputs: [], nodeResults: {}, error: msg }
  } finally {
    stepLoading.value = false
  }
}

function scheduleAutoNext() {
  if (stepDone.value) return
  if (!stepExecutionId.value) return
  if (autoNextTimer.value) window.clearTimeout(autoNextTimer.value)
  autoNextTimer.value = window.setTimeout(() => {
    // 递归推进：每次等上一次状态落库后再触发下一步
    void stepNext()
  }, 300)
}

function goBack() {
  router.push('/')
}

function goList() {
  router.push('/workflows')
}

function removeSelected() {
  if (selectedEdge.value) {
    const id = selectedEdge.value.id
    edges.value = edges.value.filter((e) => e.id !== id)
    selectedEdge.value = null
    dirty.value = true
    return
  }
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  nodes.value = nodes.value.filter((n) => n.id !== id)
  edges.value = edges.value.filter((e) => e.source !== id && e.target !== id)
  selectedNode.value = null
  dirty.value = true
}

function onKeyDown(e: KeyboardEvent) {
  const key = e.key
  if (key === 'Delete' || key === 'Backspace') {
    // 避免在输入框里误删节点
    const t = e.target as HTMLElement | null
    const tag = t?.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return
    removeSelected()
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (autoNextTimer.value) {
    window.clearTimeout(autoNextTimer.value)
    autoNextTimer.value = null
  }
})
</script>

<template>
  <div class="workflow-root flex flex-col h-screen">
    <header class="flex items-center justify-between px-5 py-2.5 border-b border-white/10 bg-[#0f1430]/70 backdrop-blur-md shrink-0">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-white/5 transition-colors"
          title="返回首页"
          @click="goBack"
        >
          <ArrowLeftIcon class="w-4 h-4" />
        </button>
        <input
          v-model="workflowName"
          type="text"
          class="text-sm font-medium bg-transparent border-none focus:outline-none focus:ring-0 text-gray-100 min-w-[140px] placeholder:text-gray-500"
          placeholder="未命名工作流"
        />
        <span v-if="dirty" class="text-[11px] text-gray-500">未保存</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-200 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors"
          @click="goList"
        >
          列表
        </button>
        <button
          type="button"
          class="px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-200 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors"
          :disabled="saveLoading"
          @click="doSave"
        >
          {{ saveLoading ? '保存中' : '保存' }}
        </button>
        <button
          type="button"
          class="px-2.5 py-1.5 text-xs font-medium rounded-md text-black bg-gray-100 hover:bg-gray-200 disabled:opacity-40 transition-colors"
          :disabled="stepLoading"
          @click="stepStart"
        >
          {{ stepLoading ? '执行中' : '运行' }}
        </button>
        <!-- 逐节点运行默认自动推进，不提供“一键运行/下一步/自动下一步开关”按钮 -->
      </div>
    </header>

    <div class="flex flex-1 min-h-0">
      <div
        v-if="authError"
        class="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <div class="bg-[#0f141b] border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
          <div class="text-sm font-medium text-gray-100 mb-2">&gt; 无权限</div>
          <div class="text-xs text-gray-400">{{ authError }}</div>
          <div class="mt-4 flex justify-end gap-2">
            <button
              class="px-3 py-2 text-xs bg-gray-100 text-black hover:bg-gray-200"
              @click="goBack"
            >
              返回首页登录
            </button>
          </div>
        </div>
      </div>
      <aside class="w-52 border-r border-white/10 bg-white/[0.04] backdrop-blur-md overflow-y-auto shrink-0">
        <div class="py-3 px-3 text-[11px] font-medium uppercase tracking-wider text-gray-500">节点</div>
        <div v-for="[category, items] in paletteByCategory" :key="category" class="px-3 pb-4">
          <div class="text-[11px] font-medium text-gray-500 mb-1.5 px-0.5">{{ category }}</div>
          <div class="space-y-0.5">
            <div
              v-for="item in items"
              :key="item.type"
              draggable="true"
              class="flex items-center px-2.5 py-1.5 rounded-md text-[13px] text-gray-200 cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors"
              @dragstart="onDragStart($event, item.type)"
              @click="addNode(item.type)"
            >
              {{ item.label }}
            </div>
          </div>
        </div>
      </aside>

      <div
        ref="flowWrapperRef"
        class="flex-1 relative workflow-canvas"
        @drop="onDrop"
        @dragover="onDragOver"
      >
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          fit-view-on-init
          :snap-to-grid="snapToGrid"
          :snap-grid="[gridGap, gridGap]"
          class="vue-flow-workflow vue-flow-minimal"
          @pane-click="onPaneClick"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @connect="onConnect"
        >
          <FlowBackground v-if="showGrid" pattern-color="rgba(255,255,255,0.035)" :gap="gridGap" />
          <FlowControls class="workflow-controls" />
        </VueFlow>

        <!-- 全息虚拟助手 -->
        <div class="absolute right-5 bottom-5 z-20">
          <button
            type="button"
            class="assistant-orb"
            @click="assistantOpen = !assistantOpen"
            title="虚拟助手"
          >
            <span class="assistant-avatar">AI</span>
          </button>
          <div v-if="assistantOpen" class="assistant-panel mt-2">
            <div class="text-xs font-medium text-white mb-1.5">全息助手</div>
            <div class="text-[11px] text-[#c8d2ff] leading-5">
              <div>当前状态：{{ executionDetail?.status || (stepLoading ? 'running' : 'idle') }}</div>
              <div>已完成节点：{{ executionProgress?.finishedNodes ?? 0 }}</div>
              <div v-if="executionProgress?.last">当前节点：{{ executionProgress.last.node_id }}</div>
              <div class="mt-1 text-[#9db0ff]">建议：{{ assistantSuggestion }}</div>
            </div>
          </div>
        </div>
      </div>

      <aside
        class="w-[340px] border-l border-white/10 bg-white/[0.04] backdrop-blur-md overflow-y-auto shrink-0"
      >
        <div class="py-3 px-4 border-b border-white/5">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-2.5 py-1 text-[11px] rounded-md border transition-colors"
              :class="rightTab === 'props' ? 'border-white/10 bg-white/10 text-gray-100' : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'"
              @click="rightTab = 'props'"
            >
              属性
            </button>
            <button
              type="button"
              class="px-2.5 py-1 text-[11px] rounded-md border transition-colors"
              :class="rightTab === 'console' ? 'border-white/10 bg-white/10 text-gray-100' : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'"
              @click="rightTab = 'console'"
            >
              控制台
            </button>
            <div class="ml-auto text-[11px] text-gray-500" v-if="workflowId">id: {{ workflowId }}</div>
          </div>
        </div>
        <div v-if="rightTab === 'props'" class="p-4 space-y-4">
          <div v-if="selectedNode" class="space-y-3">
            <div class="text-[11px] text-gray-500">节点：{{ selectedNode.type }}</div>
            <div>
              <label class="block text-[11px] font-medium text-gray-400 mb-1">名称</label>
              <input
                v-model="configForm.label"
                type="text"
                class="w-full px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100 placeholder:text-gray-500"
                placeholder="显示在节点上的名称"
              />
            </div>
            <template v-for="f in selectedNodeDef?.configFields" :key="f.key">
              <div v-if="f.field === 'text'">
                <label class="block text-[11px] font-medium text-gray-400 mb-1">{{ f.label }}</label>
                <input
                  v-model="configForm[f.key]"
                  type="text"
                  class="w-full px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100 placeholder:text-gray-500"
                  :placeholder="f.label"
                />
              </div>
              <div v-else-if="f.field === 'textarea'">
                <label class="block text-[11px] font-medium text-gray-400 mb-1">{{ f.label }}</label>
                <textarea
                  v-model="configForm[f.key]"
                  rows="4"
                  class="w-full px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100 placeholder:text-gray-500 resize-y"
                  :placeholder="f.label"
                />
              </div>
              <div v-else-if="f.field === 'select'">
                <label class="block text-[11px] font-medium text-gray-400 mb-1">{{ f.label }}</label>
                <select
                  v-model="configForm[f.key]"
                  class="w-full px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100"
                >
                  <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
                </select>
              </div>
            </template>

            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 py-2 text-xs font-medium rounded-md text-gray-100 bg-white/10 hover:bg-white/15 transition-colors"
                @click="saveNodeConfig"
              >
                应用
              </button>
              <button
                type="button"
                class="py-2 px-3 text-xs font-medium rounded-md text-red-200 bg-red-500/10 hover:bg-red-500/15 transition-colors"
                @click="removeSelected"
              >
                删除
              </button>
            </div>
          </div>

          <div v-else-if="selectedEdge" class="space-y-3">
            <div class="text-xs font-medium text-gray-100">连线</div>
            <div class="text-[11px] text-gray-500">id：{{ selectedEdge.id }}</div>
            <div class="text-[11px] text-gray-500">source：{{ selectedEdge.source }} / {{ selectedEdge.sourceHandle || '-' }}</div>
            <div class="text-[11px] text-gray-500">target：{{ selectedEdge.target }} / {{ selectedEdge.targetHandle || '-' }}</div>
            <button
              type="button"
              class="w-full py-2 text-xs font-medium rounded-md text-red-200 bg-red-500/10 hover:bg-red-500/15 transition-colors"
              @click="removeSelected"
            >
              删除连线
            </button>
          </div>

          <div v-else class="space-y-3">
            <div class="text-xs font-medium text-gray-100">工作流设置</div>
            <div class="text-[11px] text-gray-500">提示：点击节点可编辑属性；按 Delete/Backspace 可删除选中节点。</div>
            <div class="pt-1 space-y-2">
              <label class="block text-[11px] text-gray-400">
                可见性
                <select
                  v-model="workflowStatus"
                  class="mt-1 w-full px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100"
                >
                  <option value="active">私有（仅自己）</option>
                  <option value="public">公开（所有登录用户可用）</option>
                  <option value="draft">草稿</option>
                </select>
              </label>
              <label class="flex items-center justify-between text-[11px] text-gray-400">
                <span>显示网格</span>
                <input v-model="showGrid" type="checkbox" class="accent-gray-200" />
              </label>
              <label class="flex items-center justify-between text-[11px] text-gray-400">
                <span>吸附网格</span>
                <input v-model="snapToGrid" type="checkbox" class="accent-gray-200" />
              </label>
              <label class="block text-[11px] text-gray-400">
                网格间距
                <input
                  v-model.number="gridGap"
                  type="number"
                  min="12"
                  max="80"
                  step="4"
                  class="mt-1 w-full px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100"
                />
              </label>
            </div>
            <button
              type="button"
              class="w-full py-2 text-xs font-medium rounded-md text-gray-100 bg-white/10 hover:bg-white/15 transition-colors"
              @click="validationIssues = validateWorkflow()"
            >
              运行前校验
            </button>
          </div>
        </div>

        <div v-else class="p-4 space-y-4">
          <div>
            <div class="text-xs font-medium text-gray-100 mb-2">输入</div>
            <label class="block text-[11px] text-gray-500 mb-1">user_input</label>
            <input
              v-model="runInput"
              type="text"
              class="w-full px-2.5 py-1.5 text-sm border border-white/10 rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-white/15 text-gray-100 placeholder:text-gray-500"
              placeholder="传入开始节点"
            />
            <div v-if="lastRunUserInput" class="mt-1 text-[11px] text-gray-500">
              本次运行实际发送：{{ lastRunUserInput }}
            </div>
          </div>

          <div>
            <div class="text-xs font-medium text-gray-100 mb-2">校验</div>
            <div v-if="validationIssues.length === 0" class="text-[11px] text-gray-500">暂无校验信息</div>
            <div v-else class="space-y-1">
              <div
                v-for="(it, i) in validationIssues"
                :key="i"
                class="text-[11px] px-2 py-1 rounded border"
                :class="it.level === 'error' ? 'text-red-200 border-red-500/20 bg-red-500/10' : 'text-amber-200 border-amber-500/20 bg-amber-500/10'"
              >
                {{ it.level.toUpperCase() }} · {{ it.message }}
              </div>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between">
              <div class="text-xs font-medium text-gray-100">运行结果</div>
              <button
                type="button"
                class="p-1 rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/5"
                title="清空"
                @click="runResult = null; executionDetail = null"
              >
                <XMarkIcon class="w-4 h-4" />
              </button>
            </div>
            <div v-if="stepLoading" class="text-[11px] text-gray-500 mt-2">执行中…</div>
            <template v-else-if="runResult">
              <div v-if="runResult.error" class="mt-2 text-[11px] text-red-200 border border-red-500/20 bg-red-500/10 rounded px-2 py-1">
                error: {{ runResult.error }}
              </div>
              <div class="text-[11px] text-gray-500 mt-2" v-if="runResult.executionId">execution_id: {{ runResult.executionId }}</div>
              <div v-if="executionProgress" class="mt-2 text-[11px] text-gray-500">
                已完成节点：{{ executionProgress.finishedNodes }}
                <span v-if="executionProgress.last">｜当前：{{ executionProgress.last.node_id }}（{{ executionProgress.last.status }}）</span>
              </div>
              <div class="mt-2 space-y-2">
                <div class="text-[11px] text-gray-500">{{ runResult.outputs?.length ?? 0 }} 个输出</div>
                <pre
                  v-if="runResult.outputs?.length"
                  class="p-3 text-[11px] text-gray-200 bg-white/5 rounded-md overflow-auto max-h-44 font-mono"
                >{{ runResult.outputs.join('\n\n') }}</pre>
              </div>

              <details v-if="executionDetail || executionDetailLoading" class="text-[11px] mt-3">
                <summary class="cursor-pointer text-gray-400 py-1">执行详情（节点级日志）</summary>
                <div v-if="executionDetailLoading" class="mt-2 text-[11px] text-gray-500">加载中…</div>
                <div v-else-if="executionDetail" class="mt-2">
                  <div class="text-[11px] text-gray-500 mb-2">status: {{ executionDetail.status }}</div>
                  <div class="overflow-x-auto border border-white/10 rounded">
                    <table class="min-w-full text-[11px]">
                      <thead class="bg-white/5">
                        <tr>
                          <th class="text-left p-2 text-gray-400">node</th>
                          <th class="text-left p-2 text-gray-400">status</th>
                          <th class="text-left p-2 text-gray-400">error</th>
                          <th class="text-left p-2 text-gray-400">io</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="n in executionDetail.nodes" :key="n.id" class="border-t border-white/10 align-top">
                          <td class="p-2 whitespace-nowrap text-gray-200">{{ n.node_id }}</td>
                          <td class="p-2 whitespace-nowrap text-gray-200">{{ n.status }}</td>
                          <td class="p-2 max-w-[240px] truncate text-gray-300" :title="n.error_message || ''">{{ n.error_message || '-' }}</td>
                          <td class="p-2">
                            <details class="text-[11px]">
                              <summary class="cursor-pointer text-gray-400">展开</summary>
                              <div class="mt-2 grid grid-cols-1 gap-2">
                                <div>
                                  <div class="text-[11px] text-gray-500 mb-1">input</div>
                                  <pre class="p-2 bg-white/5 rounded overflow-auto max-h-40 text-gray-200 font-mono">{{ JSON.stringify(n.input, null, 2) }}</pre>
                                </div>
                                <div>
                                  <div class="text-[11px] text-gray-500 mb-1">output</div>
                                  <pre
                                    v-if="n.status === 'success' || n.status === 'fail'"
                                    class="p-2 bg-white/5 rounded overflow-auto max-h-40 text-gray-200 font-mono"
                                  >{{ JSON.stringify(n.output, null, 2) }}</pre>
                                  <div v-else class="text-[11px] text-gray-500 p-2 bg-white/5 rounded">
                                    处理中…
                                  </div>
                                </div>
                              </div>
                            </details>
                          </td>
                        </tr>
                        <tr v-if="executionDetail.nodes.length === 0">
                          <td class="p-3 text-gray-500" colspan="4">暂无节点记录</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>

              <details class="text-[11px] mt-3">
                <summary class="cursor-pointer text-gray-400 py-1">节点结果</summary>
                <pre class="mt-2 p-3 text-[11px] text-gray-200 bg-white/5 rounded-md overflow-auto max-h-56 font-mono">{{ JSON.stringify(runResult.nodeResults, null, 2) }}</pre>
              </details>
            </template>
            <div v-else class="text-[11px] text-gray-500 mt-2">暂无运行结果</div>
          </div>
        </div>
      </aside>
    </div>
    <!-- 底部执行台 -->
    <section class="border-t border-white/10 bg-[#0f1430]/70 backdrop-blur-md shrink-0">
      <div class="flex items-center justify-between px-4 py-2">
        <div class="text-xs text-[#dce3ff]">执行控制台</div>
        <button
          type="button"
          class="text-[11px] px-2 py-1 rounded bg-white/10 text-[#dce3ff] hover:bg-white/15"
          @click="consoleCollapsed = !consoleCollapsed"
        >
          {{ consoleCollapsed ? '展开' : '收起' }}
        </button>
      </div>
      <div v-if="!consoleCollapsed" class="px-4 pb-4">
        <div class="grid grid-cols-3 gap-3 text-[11px]">
          <div class="rounded border border-white/10 bg-white/[0.03] p-2">
            <div class="text-[#97a7df]">execution_id</div>
            <div class="text-[#e8edff] mt-1">{{ runResult?.executionId || '-' }}</div>
          </div>
          <div class="rounded border border-white/10 bg-white/[0.03] p-2">
            <div class="text-[#97a7df]">status</div>
            <div class="text-[#e8edff] mt-1">{{ executionDetail?.status || (stepLoading ? 'running' : 'idle') }}</div>
          </div>
          <div class="rounded border border-white/10 bg-white/[0.03] p-2">
            <div class="text-[#97a7df]">已完成节点</div>
            <div class="text-[#e8edff] mt-1">{{ executionProgress?.finishedNodes ?? 0 }}</div>
          </div>
        </div>
        <div class="mt-3 rounded border border-white/10 bg-white/[0.03] p-2">
          <div class="text-[#97a7df] text-[11px] mb-1">实时输出（JSON）</div>
          <pre class="text-[11px] text-[#e8edff] max-h-36 overflow-auto font-mono">{{ JSON.stringify(executionDetail?.nodes || [], null, 2) }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>

<style>
.workflow-root {
  background:
    radial-gradient(1200px 500px at 20% 10%, rgba(168, 85, 247, 0.22), transparent 60%),
    radial-gradient(1000px 400px at 80% 20%, rgba(59, 130, 246, 0.22), transparent 60%),
    radial-gradient(900px 360px at 50% 85%, rgba(236, 72, 153, 0.18), transparent 60%),
    #090d1f;
}
.workflow-canvas {
  background:
    radial-gradient(900px 380px at 30% 15%, rgba(168,85,247,0.08), transparent 60%),
    radial-gradient(800px 340px at 75% 25%, rgba(59,130,246,0.08), transparent 60%),
    #0b1026;
}
.vue-flow-workflow {
  --vf-node-bg: transparent;
  --vf-node-border: transparent;
  --vf-node-text: currentColor;
}
.vue-flow-minimal .vue-flow__edge-path {
  stroke: rgba(116, 155, 255, 0.5);
  stroke-width: 2;
  stroke-dasharray: 8 8;
  animation: edgeFlow 1.2s linear infinite;
}
.vue-flow__edge.exec-edge-active .vue-flow__edge-path {
  stroke: rgba(245, 158, 11, 0.95);
  stroke-width: 2.6;
  filter: drop-shadow(0 0 6px rgba(245, 158, 11, .65));
}
.vue-flow__edge.exec-edge-done .vue-flow__edge-path {
  stroke: rgba(34, 197, 94, 0.85);
  stroke-width: 2.2;
  filter: drop-shadow(0 0 4px rgba(34, 197, 94, .5));
}
.vue-flow__edge.exec-edge-fail .vue-flow__edge-path {
  stroke: rgba(239, 68, 68, 0.9);
  stroke-width: 2.4;
  filter: drop-shadow(0 0 4px rgba(239, 68, 68, .45));
}
.vue-flow-minimal .vue-flow__controls-button {
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.55);
}
.vue-flow-minimal .vue-flow__controls-button:hover {
  color: rgba(255,255,255,0.9);
}
.workflow-controls {
  bottom: 1.25rem;
  left: 1.25rem;
  box-shadow: none;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(15, 20, 27, 0.9);
}

.vue-flow__node.magic-node {
  position: relative;
  box-shadow: 0 0 0 1px rgba(168, 85, 247, .25), 0 0 18px rgba(59, 130, 246, .15);
}

.vue-flow__node.magic-node::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 10px;
  pointer-events: none;
  background: linear-gradient(120deg, rgba(168,85,247,.35), rgba(59,130,246,.35), rgba(236,72,153,.35));
  opacity: .28;
  mix-blend-mode: screen;
}
.assistant-orb {
  width: 46px;
  height: 46px;
  border-radius: 9999px;
  border: 1px solid rgba(255,255,255,0.25);
  background: linear-gradient(135deg, rgba(168,85,247,.35), rgba(59,130,246,.35), rgba(236,72,153,.35));
  box-shadow: 0 0 25px rgba(168,85,247,.35), 0 0 35px rgba(59,130,246,.25);
}
.assistant-avatar {
  font-size: 12px;
  color: #fff;
  font-weight: 600;
}
.assistant-panel {
  width: 220px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(14, 20, 44, 0.78);
  backdrop-filter: blur(12px);
  padding: 10px;
  box-shadow: 0 0 24px rgba(95,146,255,.22);
}
@keyframes edgeFlow {
  to { stroke-dashoffset: -16; }
}

.vue-flow__node.exec-success {
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.65), 0 0 0 6px rgba(34, 197, 94, 0.12);
  position: relative;
}

.vue-flow__node.exec-success::after {
  content: '✓';
  position: absolute;
  top: 6px;
  right: 6px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-size: 10px;
  background: rgba(34, 197, 94, 0.18);
  color: rgba(34, 197, 94, 1);
}

.vue-flow__node.exec-fail {
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.65), 0 0 0 6px rgba(239, 68, 68, 0.12);
  position: relative;
}

.vue-flow__node.exec-fail::after {
  content: '✕';
  position: absolute;
  top: 6px;
  right: 6px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-size: 10px;
  background: rgba(239, 68, 68, 0.18);
  color: rgba(239, 68, 68, 1);
}

.vue-flow__node.exec-running {
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.55), 0 0 0 6px rgba(245, 158, 11, 0.12);
  animation: workflowPulse 1.2s ease-in-out infinite;
  position: relative;
}

.vue-flow__node.exec-running::before {
  opacity: .45;
}

.vue-flow__node.exec-running::after {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgba(245, 158, 11, 0.95);
  box-shadow: 0 0 10px rgba(245,158,11,.85), 14px -8px 0 rgba(245,158,11,.45), 22px 8px 0 rgba(245,158,11,.25);
  animation: nodeParticleTrail 0.9s linear infinite;
}

@keyframes workflowPulse {
  0% { filter: brightness(1); }
  50% { filter: brightness(1.15); }
  100% { filter: brightness(1); }
}

@keyframes nodeParticleTrail {
  0% { transform: translateX(0) translateY(-50%); opacity: .9; }
  100% { transform: translateX(18px) translateY(-50%); opacity: .15; }
}
</style>
