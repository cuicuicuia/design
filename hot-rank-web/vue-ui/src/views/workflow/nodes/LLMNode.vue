<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getNodeDef } from '../nodeDefs'

const props = defineProps<{ data?: Record<string, unknown> }>()
const def = getNodeDef('llm')
</script>

<template>
  <div class="min-w-[172px] rounded-md border border-white/10 bg-[#0f141b] overflow-hidden">
    <div class="px-3 py-2 border-b border-white/5">
      <span class="text-xs font-medium text-gray-100">{{ props.data?.label || 'LLM' }}</span>
    </div>
    <div class="px-3 py-1.5 space-y-1">
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
    <div class="px-3 py-1.5 flex items-center justify-end gap-1.5 border-t border-white/5">
      <template v-for="out in def?.outputs" :key="out.id">
        <span class="text-[10px] text-gray-400">{{ out.label }}</span>
        <Handle
          :id="out.id"
          type="source"
          :position="Position.Right"
          class="!w-2 !h-2 !min-w-0 !min-h-0 !bg-gray-500 !border-0 !right-0"
        />
      </template>
    </div>
  </div>
</template>
