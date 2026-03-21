<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { XMarkIcon, PaperAirplaneIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/vue/16/solid'
import { postChatStream } from '@/api/hotRank'

const DEFAULT_SUMMARY_PROMPT = '请对这条资讯做简要摘要。'

const props = defineProps({
  visible: { type: Boolean, default: false },
  context: {
    type: Object,
    default: () => ({ title: '', url: '' }),
  },
})

const emit = defineEmits(['close'])

const messages = ref([])
const inputText = ref('')
const loading = ref(false)
const reasoningExpanded = ref({})

function toggleReasoning(index) {
  reasoningExpanded.value[index] = !reasoningExpanded.value[index]
}

// 打开弹窗时清空历史，若有 context 则自动请求摘要
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      messages.value = []
      inputText.value = ''
      reasoningExpanded.value = {}
      const hasContext = props.context?.title || props.context?.url
      if (hasContext) {
        await nextTick()
        send(DEFAULT_SUMMARY_PROMPT)
      }
    }
  },
)

async function send(overrideMessage) {
  const text = (overrideMessage ?? (inputText.value || '')).trim()
  if (!text || loading.value) return

  const userMsg = { role: 'user', content: text }
  messages.value.push(userMsg)
  if (!overrideMessage) inputText.value = ''
  loading.value = true

  const context =
    props.context?.title || props.context?.url
      ? { title: props.context.title, url: props.context.url }
      : undefined

  const assistantIndex = messages.value.length
  messages.value.push({ role: 'assistant', content: '', reasoning: '' })
  reasoningExpanded.value[assistantIndex] = true

  try {
    await postChatStream(context, text, ({ type, chunk }) => {
      const msg = messages.value[assistantIndex]
      if (!msg || msg.role !== 'assistant') return
      if (type === 'reasoning') msg.reasoning = (msg.reasoning || '') + chunk
      else msg.content += chunk
    })
    const last = messages.value[assistantIndex]
    if (last && last.content === '' && !last.reasoning) {
      last.content = '暂无回复，请稍后再试。'
    }
  } catch (e) {
    console.error('Chat error:', e)
    const last = messages.value[assistantIndex]
    if (last) last.content = '请求失败，请检查网络或稍后再试。'
  } finally {
    loading.value = false
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click.self="close"
  >
    <div
      class="bg-white dark:bg-gray-800 font-mono rounded-lg max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col dark:text-white shadow-xl"
    >
      <div class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 class="text-lg font-bold">千问 AI · 聊这条资讯</h3>
        <button
          type="button"
          class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="close"
        >
          <XMarkIcon class="h-5 w-5" />
        </button>
      </div>

      <div v-if="context?.title || context?.url" class="px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-sm shrink-0">
        <div v-if="context.title" class="font-medium truncate" :title="context.title">
          {{ context.title }}
        </div>
        <a
          v-if="context.url"
          :href="context.url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-blue-600 dark:text-blue-400 hover:underline truncate block"
        >
          {{ context.url }}
        </a>
      </div>

      <div class="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
        <div
          v-if="messages.length === 0 && !loading"
          class="text-sm text-gray-500 dark:text-gray-400 text-center py-8"
        >
          输入问题，让千问结合上面资讯帮你解读或总结
        </div>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="flex flex-col gap-2"
          :class="msg.role === 'user' ? 'items-end' : 'items-start'"
        >
          <div
            v-if="msg.role === 'user'"
            class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words bg-blue-500 text-white"
          >
            {{ msg.content }}
          </div>
          <template v-else>
            <div
              v-if="msg.reasoning"
              class="max-w-[85%] w-full rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden"
            >
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/80 hover:bg-gray-100 dark:hover:bg-gray-700"
                @click="toggleReasoning(i)"
              >
                <component :is="reasoningExpanded[i] ? ChevronUpIcon : ChevronDownIcon" class="h-4 w-4 shrink-0" />
                <span>思考过程</span>
              </button>
              <div
                v-show="reasoningExpanded[i]"
                class="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
              >
                {{ msg.reasoning }}
              </div>
            </div>
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
            >
              {{ msg.content }}
            </div>
          </template>
        </div>
        <div
          v-if="loading && (!messages.length || messages[messages.length - 1]?.content === '')"
          class="flex justify-start"
        >
          <div class="rounded-lg px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-500">
            千问正在思考…
          </div>
        </div>
      </div>

      <div class="p-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <div class="flex gap-2">
          <input
            v-model="inputText"
            type="text"
            placeholder="输入问题…"
            class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            :disabled="loading"
            @keydown.enter.prevent="send()"
          />
          <button
            type="button"
            class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded flex items-center gap-1 disabled:opacity-50"
            :disabled="loading || !inputText.trim()"
            @click="send"
          >
            <PaperAirplaneIcon class="h-4 w-4" />
            发送
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
