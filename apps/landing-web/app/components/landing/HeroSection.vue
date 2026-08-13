<script setup lang="ts">
import { TresCanvas } from '@tresjs/core';
import { ChevronDown, Github, MapPin, Radio, Waypoints, Zap } from 'lucide-vue-next';

const HeroCityScene = defineAsyncComponent(() => import('~/components/three/HeroCityScene.vue'));

const canvasWrapRef = ref<HTMLElement | null>(null);
const isInView = useInView(canvasWrapRef, { once: false, threshold: 0 });
const isPageVisible = usePageVisible();
const prefersReduced = useReducedMotion();

const dpr = ref<[number, number]>([1, 1]);
const dense = ref(true);

onMounted(() => {
  const isSmallViewport = window.innerWidth < 768;
  const isLowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  dense.value = !(isSmallViewport || isLowPower);
  dpr.value = [1, Math.min(2, window.devicePixelRatio || 1)];
});

const scenePaused = computed(() => !isInView.value || !isPageVisible.value);

const trustIndicators = [
  { label: 'Realtime GPS', icon: Radio },
  { label: 'Event Driven', icon: Zap },
  { label: 'Geo Spatial', icon: MapPin },
  { label: 'Scale Ready', icon: Waypoints },
];
</script>

<template>
  <section class="relative min-h-screen overflow-hidden bg-bg">
    <div ref="canvasWrapRef" class="absolute inset-0">
      <TresCanvas v-if="!prefersReduced" class="!absolute inset-0" alpha :dpr="dpr" render-mode="always">
        <HeroCityScene :dense="dense" :reduce-motion="prefersReduced" :paused="scenePaused" />
      </TresCanvas>
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_20%,rgba(79,172,254,0.12),transparent)]"
      />
      <div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg" />
      <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
    </div>

    <div class="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-32 text-center">
      <Reveal>
        <span
          class="inline-flex items-center gap-2 rounded-full border border-line bg-bg-elevated/60 px-4 py-1.5 text-xs font-medium tracking-wide text-ink-dim"
        >
          <span class="size-1.5 rounded-full bg-signal-green animate-pulse-slow" />
          geofleet-platform
        </span>
      </Reveal>

      <Reveal :delay="80">
        <h1 class="mt-8 font-display text-5xl font-bold tracking-tight text-balance text-ink sm:text-6xl lg:text-7xl">
          Movement,
          <span class="text-gradient">orchestrated</span>
          in real time.
        </h1>
      </Reveal>

      <Reveal :delay="160">
        <p class="mt-6 max-w-2xl text-lg leading-relaxed text-ink-dim sm:text-xl">
          GeoFleet is a scalable ride-hailing and fleet intelligence platform connecting riders,
          drivers, live GPS, dispatch, and operations through one realtime system.
        </p>
      </Reveal>

      <Reveal :delay="240">
        <div class="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#demo"
            class="rounded-full bg-gradient-to-r from-cyan to-blue px-6 py-3 text-sm font-semibold text-bg shadow-lg shadow-cyan/20 transition hover:brightness-110"
          >
            Experience the Platform
          </a>
          <a
            href="#architecture"
            class="rounded-full border border-line bg-bg-elevated/50 px-6 py-3 text-sm font-semibold text-ink transition hover:border-ink-faint"
          >
            Explore Architecture
          </a>
          <a
            href="https://github.com/abdullah-alfar"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-ink-dim transition hover:text-ink"
          >
            <Github class="size-4" aria-hidden="true" />
            View on GitHub
          </a>
        </div>
      </Reveal>

      <Reveal :delay="320">
        <ul class="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <li v-for="item in trustIndicators" :key="item.label" class="flex items-center gap-2 text-sm text-ink-faint">
            <component :is="item.icon" class="size-4 text-cyan" aria-hidden="true" />
            {{ item.label }}
          </li>
        </ul>
      </Reveal>
    </div>

    <a
      href="#demo"
      class="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-ink-faint transition hover:text-ink"
      aria-label="Scroll to product demo"
    >
      <ChevronDown class="size-6 animate-bounce" aria-hidden="true" />
    </a>
  </section>
</template>
