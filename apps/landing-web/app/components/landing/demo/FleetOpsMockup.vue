<script setup lang="ts">
const stats = [
  { label: 'Active drivers', value: 428, suffix: '' },
  { label: 'Trips today', value: 1204, suffix: '' },
  { label: 'Avg ETA', value: 4, suffix: ' min' },
];

const regions = [
  { name: 'Amman', drivers: 214, load: 78 },
  { name: 'Zarqa', drivers: 96, load: 52 },
  { name: 'Irbid', drivers: 71, load: 41 },
  { name: 'Aqaba', drivers: 47, load: 33 },
];
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-line bg-bg-elevated/50">
    <div class="flex items-center justify-between border-b border-line px-5 py-3">
      <p class="text-sm font-medium text-ink">Operations overview</p>
      <span class="flex items-center gap-1.5 text-xs text-ink-faint">
        <span class="size-1.5 rounded-full bg-signal-green animate-pulse-slow" />
        Live
      </span>
    </div>

    <div class="grid grid-cols-3 gap-px bg-line">
      <div v-for="s in stats" :key="s.label" class="bg-bg-elevated px-4 py-4">
        <p class="font-display text-2xl font-bold text-ink">
          <AnimatedCounter :to="s.value" :suffix="s.suffix" />
        </p>
        <p class="mt-1 text-xs text-ink-faint">{{ s.label }}</p>
      </div>
    </div>

    <div class="space-y-3 p-5">
      <p class="text-xs font-medium tracking-wide text-ink-faint uppercase">By region</p>
      <div v-for="r in regions" :key="r.name" class="flex items-center gap-3">
        <span class="w-14 shrink-0 text-xs text-ink-dim">{{ r.name }}</span>
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-bg">
          <div class="h-full rounded-full bg-gradient-to-r from-cyan to-blue" :style="{ width: `${r.load}%` }" />
        </div>
        <span class="w-16 shrink-0 text-right text-xs text-ink-faint">{{ r.drivers }} drivers</span>
      </div>
    </div>
  </div>
</template>
