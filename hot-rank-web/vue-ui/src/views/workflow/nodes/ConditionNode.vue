<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getNodeDef } from '../nodeDefs'

const props = defineProps<{ data?: Record<string, unknown> }>()
const def = getNodeDef('condition')
</script>

<template>
  <div class="min-w-[172px] rounded-md border border-white/10 bg-[#0f141b] overflow-hidden">
    <div class="px-3 py-2 border-b border-white/5">
      <span class="text-xs font-medium text-gray-100">{{ props.data?.label || '条件' }}</span>
    </div>
    <div class="px-3 py-1.5">
      <template v-for="inp in def?.inputs" :key="inp.id">
        <div class="flex items-center gap-2">
          <Handle
            :id="inp.id"
            type="target"
            :position="Position.Left"
            class="!w-2 !h-2 !min-w-0 !min-h-0 !bg-gray-500 !border-0 !left-0"
          />
          <span class="text-[10px] text-gray-400">{{ inp.label }}</span>
        </div>
      </template>
    </div>
    <div class="px-3 py-1.5 flex items-center justify-end gap-3 border-t border-white/5">
      <template v-for="out in def?.outputs" :key="out.id">
        <div class="flex items-center gap-1">
          <span class="text-[10px] text-gray-400">{{ out.label }}</span>
          <Handle
            :id="out.id"
            type="source"
            :position="Position.Right"
            :class="out.id === 'yes' ? '!bg-gray-400' : '!bg-gray-600'"
            class="!w-2 !h-2 !min-w-0 !min-h-0 !border-0 !right-0"
          />
        </div>
      </template>
    </div>
  </div>
</template>
