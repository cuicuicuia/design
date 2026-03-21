<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { XMarkIcon } from '@heroicons/vue/16/solid'
import { useI18n } from 'vue-i18n'
import { login, register, type UserInfo, type AuthSuccessPayload } from '@/api/user'
import { AUTH_TOKEN_KEY } from '@/utils/request'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'authed', payload: { user: UserInfo; token: string }): void
}>()

const { t } = useI18n()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

const titleText = computed(() =>
  mode.value === 'login' ? t('app.loginTitle') : t('app.registerTitle'),
)

const submitText = computed(() =>
  mode.value === 'login' ? t('app.loginSubmit') : t('app.registerSubmit'),
)

watch(
  () => props.visible,
  (v) => {
    if (v) {
      errorMsg.value = ''
      loading.value = false
    }
  },
)

function switchMode(next: 'login' | 'register') {
  if (mode.value === next) return
  mode.value = next
  errorMsg.value = ''
}

async function handleSubmit() {
  if (loading.value) return
  errorMsg.value = ''
  const emailVal = email.value.trim()
  const usernameVal = username.value.trim()
  const pw = password.value

  if (mode.value === 'register') {
    if (!emailVal) {
      errorMsg.value = t('app.emailRequired')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      errorMsg.value = t('app.invalidEmailFormat')
      return
    }
    if (pw.length < 8) {
      errorMsg.value = t('app.passwordMinLength')
      return
    }
  } else {
    if (!emailVal && !usernameVal) {
      errorMsg.value = t('app.emailOrUsernameRequired')
      return
    }
  }
  if (!pw) {
    errorMsg.value = t('app.passwordRequired')
    return
  }

  loading.value = true
  try {
    let resp: AuthSuccessPayload | null = null
    if (mode.value === 'login') {
      const r = await login({ account: emailVal || usernameVal, password: pw })
      if (r.code !== 200 || !r.data) {
        throw new Error(r.msg || 'login failed')
      }
      resp = r.data
    } else {
      const r = await register({ email: emailVal, username: usernameVal || undefined, password: pw })
      if (r.code !== 200 || !r.data) {
        throw new Error(r.msg || 'register failed')
      }
      resp = r.data
    }
    if (!resp) throw new Error('no data')
    const { user, token } = resp
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token)
    }
    emit('authed', { user, token })
  } catch (e: unknown) {
    console.error('auth error:', e)
    const err = e as { response?: { data?: { msg?: unknown } }; message?: unknown }
    const backendMsg = err?.response?.data?.msg
    const message = typeof err?.message === 'string' ? err.message : ''
    errorMsg.value = typeof backendMsg === 'string' ? backendMsg : (message || t('app.networkError'))
  } finally {
    loading.value = false
  }
}

function onClose() {
  emit('close')
}
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    @click.self="onClose"
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 font-mono text-sm text-black dark:text-white"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 class="font-bold text-base">
          &gt; {{ titleText }}
        </h3>
        <button
          type="button"
          class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="onClose"
        >
          <XMarkIcon class="h-5 w-5" />
        </button>
      </div>

      <div class="px-4 py-4 space-y-3">
        <div class="flex space-x-2 text-xs mb-1">
          <button
            type="button"
            class="px-2 py-1 rounded border"
            :class="mode === 'login'
              ? 'bg-black text-white border-black dark:bg-gray-200 dark:text-black'
              : 'border-gray-300 dark:border-gray-600'"
            @click="switchMode('login')"
          >
            {{ t('app.loginTab') }}
          </button>
          <button
            type="button"
            class="px-2 py-1 rounded border"
            :class="mode === 'register'
              ? 'bg-black text-white border-black dark:bg-gray-200 dark:text-black'
              : 'border-gray-300 dark:border-gray-600'"
            @click="switchMode('register')"
          >
            {{ t('app.registerTab') }}
          </button>
        </div>

        <div class="space-y-2">
          <label class="block text-xs">
            <span class="block mb-1">{{ t('app.emailOrUsername') }}</span>
            <input
              v-model="email"
              :placeholder="mode === 'login' ? t('app.emailOrUsernamePlaceholder') : t('app.emailPlaceholder')"
              class="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
              type="text"
            />
          </label>

          <label v-if="mode === 'register'" class="block text-xs">
            <span class="block mb-1">{{ t('app.usernameOptional') }}</span>
            <input
              v-model="username"
              :placeholder="t('app.usernamePlaceholder')"
              class="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
              type="text"
            />
          </label>

          <label class="block text-xs">
            <span class="block mb-1">{{ t('app.password') }}</span>
            <input
              v-model="password"
              :placeholder="t('app.passwordPlaceholder')"
              class="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
              type="password"
            />
          </label>
        </div>

        <p v-if="errorMsg" class="text-xs text-red-600">
          {{ errorMsg }}
        </p>

        <button
          type="button"
          class="mt-2 w-full px-3 py-2 text-xs font-semibold rounded bg-black text-white hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-gray-200 dark:text-black dark:hover:bg-gray-300"
          :disabled="loading"
          @click="handleSubmit"
        >
          <span v-if="!loading">{{ submitText }}</span>
          <span v-else>{{ t('app.loading') }}</span>
        </button>

        <p class="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
          {{ t('app.authHint') }}
        </p>
      </div>
    </div>
  </div>
</template>

