<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getNodeDef } from '../nodeDefs'

const props = defineProps<{ data?: Record<string, unknown> }>()
const def = getNodeDef('start')
</script>

<template>
  <div class="min-w-[160px] rounded-md border border-white/10 bg-[#0f141b] overflow-hidden">
    <div class="flex items-center justify-between px-3 py-2">
      <span class="text-xs font-medium text-gray-100">{{ props.data?.label || '开始' }}</span>
      <template v-for="out in def?.outputs" :key="out.id">
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-gray-400">{{ out.label }}</span>
          <Handle
            :id="out.id"
            type="source"
            :position="Position.Right"
            class="!w-2 !h-2 !min-w-0 !min-h-0 !bg-gray-500 !border-0 !right-0"
          />
        </div>
      </template>
    </div>
  </div>
</template>
