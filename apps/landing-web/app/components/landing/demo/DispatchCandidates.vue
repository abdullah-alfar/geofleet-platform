<script setup lang="ts">
import { Check, Star } from 'lucide-vue-next';

const candidates = [
  { name: 'Omar', rating: 4.9, distance: '0.4 km', eta: '2 min', chosen: true },
  { name: 'Layla', rating: 4.8, distance: '0.9 km', eta: '4 min', chosen: false },
  { name: 'Khaled', rating: 4.7, distance: '1.1 km', eta: '5 min', chosen: false },
  { name: 'Rana', rating: 4.6, distance: '1.6 km', eta: '7 min', chosen: false },
];
</script>

<template>
  <div class="rounded-2xl border border-line bg-bg-elevated/50 p-5">
    <div class="mb-4 flex items-center justify-between">
      <p class="text-sm font-medium text-ink">Nearby drivers</p>
      <span class="text-xs text-ink-faint">Ranked by ETA</span>
    </div>
    <ul class="space-y-2">
      <li
        v-for="c in candidates"
        :key="c.name"
        class="flex items-center justify-between rounded-xl border px-3 py-2.5 transition"
        :class="c.chosen ? 'border-cyan/40 bg-cyan/10' : 'border-transparent bg-bg/40'"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex size-8 items-center justify-center rounded-full text-xs font-semibold"
            :class="c.chosen ? 'bg-cyan text-bg' : 'bg-bg-elevated text-ink-dim'"
          >
            {{ c.name[0] }}
          </span>
          <div>
            <p class="flex items-center gap-1 text-sm font-medium text-ink">
              {{ c.name }}
              <span class="flex items-center gap-0.5 text-xs text-ink-faint">
                <Star class="size-3 fill-streetlight text-streetlight" aria-hidden="true" />
                {{ c.rating }}
              </span>
            </p>
            <p class="text-xs text-ink-faint">{{ c.distance }} away</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium" :class="c.chosen ? 'text-cyan' : 'text-ink-faint'">{{ c.eta }}</span>
          <Check v-if="c.chosen" class="size-4 text-cyan" aria-hidden="true" />
        </div>
      </li>
    </ul>
  </div>
</template>
