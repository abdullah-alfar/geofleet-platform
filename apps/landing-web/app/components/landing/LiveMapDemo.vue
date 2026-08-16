<script setup lang="ts">
export type MapPhase = 'idle' | 'searching' | 'assigned' | 'tracking' | 'route';

const props = withDefaults(
  defineProps<{
    phase?: MapPhase;
    eta?: string;
    compact?: boolean;
  }>(),
  { phase: undefined, eta: '', compact: false },
);

const prefersReduced = useReducedMotion();

const internalPhase = ref<MapPhase>('idle');
const AUTO_SEQUENCE: MapPhase[] = ['idle', 'searching', 'assigned', 'tracking'];
let autoTimer: ReturnType<typeof setInterval> | undefined;

const activePhase = computed(() => props.phase ?? internalPhase.value);

onMounted(() => {
  if (props.phase !== undefined || prefersReduced.value) return;
  let i = 0;
  autoTimer = setInterval(() => {
    i = (i + 1) % AUTO_SEQUENCE.length;
    internalPhase.value = AUTO_SEQUENCE[i]!;
  }, 2600);
});
onBeforeUnmount(() => autoTimer && clearInterval(autoTimer));

// Static candidate driver positions (searching state).
const candidates = [
  { x: 90, y: 70 },
  { x: 230, y: 60 },
  { x: 250, y: 150 },
  { x: 70, y: 150 },
];

const rider = { x: 160, y: 120 };
const destination = { x: 250, y: 40 };

const assignedPos = computed(() => {
  switch (activePhase.value) {
    case 'idle':
      return { x: 90, y: 70 };
    case 'searching':
      return { x: 90, y: 70 };
    case 'assigned':
      return { x: 120, y: 90 };
    case 'tracking':
      return rider;
    case 'route':
      return destination;
    default:
      return { x: 90, y: 70 };
  }
});

const showCandidates = computed(() => activePhase.value === 'idle' || activePhase.value === 'searching');
const showSearchRings = computed(() => activePhase.value === 'searching');
const showRoute = computed(() => activePhase.value === 'route');
</script>

<template>
  <div class="relative w-full" :class="compact ? 'aspect-[4/3]' : 'aspect-[16/11]'">
    <svg viewBox="0 0 320 220" class="h-full w-full" role="img" aria-label="Live map of nearby drivers and trip route">
      <defs>
        <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#4facfe" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#4facfe" stop-opacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="320" height="220" rx="16" fill="#0f1625" />
      <circle cx="160" cy="110" r="130" fill="url(#mapGlow)" />

      <g stroke="#1e2740" stroke-width="1">
        <line v-for="i in 6" :key="`h-${i}`" :x1="0" :x2="320" :y1="i * 34" :y2="i * 34" />
        <line v-for="i in 8" :key="`v-${i}`" :x1="i * 36" :x2="i * 36" :y1="0" :y2="220" />
      </g>

      <!-- Route (drawn progressively once assigned) -->
      <polyline
        v-if="showRoute || activePhase === 'tracking'"
        :points="`${rider.x},${rider.y} ${destination.x},${destination.y}`"
        fill="none"
        stroke="#00f2fe"
        stroke-width="2.5"
        stroke-linecap="round"
        :stroke-dasharray="showRoute ? 'none' : '4 6'"
        :opacity="showRoute ? 0.9 : 0.5"
        style="transition: stroke-dasharray 1.6s ease, opacity 0.6s ease"
      />

      <!-- Search rings -->
      <g v-if="showSearchRings">
        <circle
          v-for="n in 3"
          :key="n"
          :cx="rider.x"
          :cy="rider.y"
          r="6"
          fill="none"
          stroke="#4ade80"
          stroke-width="1.5"
          class="origin-center animate-[search-ring_2.4s_ease-out_infinite]"
          :style="{ animationDelay: `${n * 0.6}s` }"
        />
      </g>

      <!-- Other candidate vehicles -->
      <circle
        v-for="(c, i) in showCandidates ? candidates : []"
        :key="i"
        :cx="c.x"
        :cy="c.y"
        r="4"
        fill="#4facfe"
        opacity="0.55"
      />

      <!-- Rider pin -->
      <g :transform="`translate(${rider.x}, ${rider.y})`">
        <circle r="7" fill="#4ade80" opacity="0.25" />
        <circle r="4" fill="#4ade80" />
      </g>

      <!-- Destination pin -->
      <g v-if="showRoute" :transform="`translate(${destination.x}, ${destination.y})`">
        <circle r="7" fill="#00f2fe" opacity="0.25" />
        <circle r="4" fill="#00f2fe" />
      </g>

      <!-- Assigned / highlighted vehicle -->
      <g
        :transform="`translate(${assignedPos.x}, ${assignedPos.y})`"
        style="transition: transform 1.8s cubic-bezier(0.4, 0, 0.2, 1)"
      >
        <circle r="9" fill="#00f2fe" opacity="0.2" />
        <circle r="5" fill="#00f2fe" stroke="#0b0f19" stroke-width="1.5" />
      </g>
    </svg>

    <div v-if="eta" class="absolute bottom-3 left-3 rounded-full glass px-3 py-1 text-xs font-medium text-ink">
      {{ eta }}
    </div>
  </div>
</template>

<style scoped>
@keyframes search-ring {
  0% {
    r: 4;
    opacity: 0.9;
  }
  100% {
    r: 46;
    opacity: 0;
  }
}
</style>
