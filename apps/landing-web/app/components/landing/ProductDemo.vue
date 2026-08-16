<script setup lang="ts">
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-vue-next';
import type { MapPhase } from './LiveMapDemo.vue';
import type { RiderScreen } from './demo/RiderPhone.vue';

interface Step {
  id: string;
  label: string;
  duration: number;
  riderScreen: RiderScreen;
  mapPhase: MapPhase;
  eta?: string;
}

const STEPS: Step[] = [
  { id: 'request', label: 'Request', duration: 3200, riderScreen: 'request', mapPhase: 'idle' },
  { id: 'matching', label: 'Matching', duration: 3600, riderScreen: 'searching', mapPhase: 'searching' },
  { id: 'accept', label: 'Driver accepts', duration: 3000, riderScreen: 'searching', mapPhase: 'assigned' },
  { id: 'enroute', label: 'En route', duration: 3600, riderScreen: 'tracking', mapPhase: 'tracking', eta: '3 min away' },
  { id: 'trip', label: 'Trip', duration: 5400, riderScreen: 'trip', mapPhase: 'route' },
];

const prefersReduced = useReducedMotion();

const stepIndex = ref(0);
const playing = ref(!prefersReduced.value);
const driverAccepted = ref(false);
const finalArrived = ref(true);

const rootEl = ref<HTMLElement | null>(null);
const isInView = useInView(rootEl, { once: false, threshold: 0.35 });

const currentStep = computed(() => STEPS[stepIndex.value]!);
const riderScreen = computed<RiderScreen>(() => {
  if (currentStep.value.id === 'trip') return finalArrived.value ? 'arrived' : 'trip';
  return currentStep.value.riderScreen;
});

let advanceTimer: ReturnType<typeof setTimeout> | undefined;
let subTimer: ReturnType<typeof setTimeout> | undefined;

function clearTimers() {
  if (advanceTimer) clearTimeout(advanceTimer);
  if (subTimer) clearTimeout(subTimer);
}

function enterStep(index: number) {
  clearTimers();
  stepIndex.value = index;
  driverAccepted.value = false;
  finalArrived.value = true;

  if (currentStep.value.id === 'accept') {
    subTimer = setTimeout(() => (driverAccepted.value = true), 1400);
  }
  if (currentStep.value.id === 'trip') {
    subTimer = setTimeout(() => (finalArrived.value = false), 1300);
  }

  if (playing.value && isInView.value) {
    advanceTimer = setTimeout(() => enterStep((stepIndex.value + 1) % STEPS.length), currentStep.value.duration);
  }
}

function goTo(index: number, { pause = true } = {}) {
  if (pause) playing.value = false;
  enterStep(index);
}

function next() {
  goTo((stepIndex.value + 1) % STEPS.length);
}
function prev() {
  goTo((stepIndex.value - 1 + STEPS.length) % STEPS.length);
}
function replay() {
  playing.value = !prefersReduced.value;
  enterStep(0);
}
function togglePlay() {
  playing.value = !playing.value;
  enterStep(stepIndex.value);
}

watch(isInView, (visible) => {
  if (visible && playing.value) enterStep(stepIndex.value);
  else clearTimers();
});

onMounted(() => enterStep(0));
onBeforeUnmount(clearTimers);
</script>

<template>
  <section id="demo" ref="rootEl" class="relative bg-bg-secondary py-28">
    <div class="mx-auto max-w-6xl px-6">
      <SectionHeading
        eyebrow="See GeoFleet in Action"
        title="From request to arrival, in one continuous flow."
        subtitle="A real trip, start to finish — no jargon, just what the rider and driver actually see."
      />

      <Reveal :delay="120" class="mt-16 grid items-center gap-10 lg:grid-cols-[280px_1fr]">
        <div class="flex justify-center">
          <Transition name="fade-slide" mode="out-in">
            <DriverPhone
              v-if="currentStep.id === 'accept'"
              key="driver"
              :screen="driverAccepted ? 'accepted' : 'incoming'"
              @accept="driverAccepted = true"
            />
            <RiderPhone v-else key="rider" :screen="riderScreen" @request="next" />
          </Transition>
        </div>

        <div class="space-y-6">
          <div class="overflow-hidden rounded-2xl border border-line bg-bg p-4">
            <LiveMapDemo :phase="currentStep.mapPhase" :eta="currentStep.eta ?? ''" />
          </div>

          <div>
            <div class="h-1 overflow-hidden rounded-full bg-line">
              <div
                :key="stepIndex"
                class="h-full rounded-full bg-gradient-to-r from-cyan to-blue"
                :style="{
                  animation:
                    playing && isInView && !prefersReduced ? `demo-progress ${currentStep.duration}ms linear forwards` : 'none',
                  width: playing && isInView && !prefersReduced ? undefined : '100%',
                }"
              />
            </div>

            <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="(step, i) in STEPS"
                  :key="step.id"
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-xs font-medium transition"
                  :class="
                    i === stepIndex
                      ? 'border-cyan/50 bg-cyan/10 text-cyan'
                      : 'border-line text-ink-faint hover:border-ink-faint hover:text-ink-dim'
                  "
                  :aria-current="i === stepIndex ? 'step' : undefined"
                  @click="goTo(i)"
                >
                  {{ step.label }}
                </button>
              </div>

              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous step"
                  class="rounded-full border border-line p-2 text-ink-dim transition hover:border-ink-faint hover:text-ink"
                  @click="prev"
                >
                  <SkipBack class="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  :aria-label="playing ? 'Pause' : 'Play'"
                  class="rounded-full border border-line p-2 text-ink-dim transition hover:border-ink-faint hover:text-ink"
                  @click="togglePlay"
                >
                  <Pause v-if="playing" class="size-4" aria-hidden="true" />
                  <Play v-else class="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next step"
                  class="rounded-full border border-line p-2 text-ink-dim transition hover:border-ink-faint hover:text-ink"
                  @click="next"
                >
                  <SkipForward class="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Replay from the start"
                  class="rounded-full border border-line p-2 text-ink-dim transition hover:border-ink-faint hover:text-ink"
                  @click="replay"
                >
                  <RotateCcw class="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
</template>

<style scoped>
@keyframes demo-progress {
  from {
    width: 0%;
  }
  to {
    width: 100%;
  }
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.4s ease,
    transform 0.4s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
