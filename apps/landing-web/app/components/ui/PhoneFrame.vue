<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: '' });
</script>

<template>
  <div class="mx-auto w-full max-w-[280px]">
    <div class="relative rounded-[2.25rem] border border-line bg-bg-elevated/80 p-2.5 shadow-2xl shadow-black/40">
      <div class="absolute top-2.5 left-1/2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-bg" />
      <div class="relative flex h-[540px] flex-col overflow-hidden rounded-[1.75rem] bg-bg-secondary">
        <div class="flex items-center justify-between px-5 pt-3 text-[11px] font-medium text-ink-faint">
          <span>9:41</span>
          <span class="flex items-center gap-1">
            <span class="h-1.5 w-1.5 rounded-full bg-signal-green" />
            GeoFleet
          </span>
        </div>
        <div class="flex flex-1 flex-col px-4 pt-4 pb-5">
          <slot />
        </div>
      </div>
    </div>
    <p v-if="label" class="mt-4 text-center text-xs font-medium tracking-wide text-ink-faint uppercase">{{ label }}</p>
  </div>
</template>
