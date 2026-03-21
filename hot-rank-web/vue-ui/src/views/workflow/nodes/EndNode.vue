<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getNodeDef } from '../nodeDefs'

const props = defineProps<{ data?: Record<string, unknown> }>()
const def = getNodeDef('end')
</script>

<template>
  <div class="min-w-[160px] rounded-md border border-white/10 bg-[#0f141b] overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2">
      <Handle
        v-for="inp in def?.inputs"
        :key="inp.id"
        :id="inp.id"
        type="target"
        :position="Position.Left"
        class="!w-2 !h-2 !min-w-0 !min-h-0 !bg-gray-500 !border-0 !left-0"
      />
      <span class="text-[10px] text-gray-400">{{ def?.inputs?.[0]?.label }}</span>
      <span class="text-xs font-medium text-gray-100 ml-auto">{{ props.data?.label || '结束' }}</span>
    </div>
  </div>
</template>
