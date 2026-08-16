<script setup lang="ts">
import { Car, MapPin, Navigation, Search, Star } from 'lucide-vue-next';

export type RiderScreen = 'request' | 'searching' | 'tracking' | 'arrived' | 'trip';

const props = defineProps<{ screen: RiderScreen }>();
const emit = defineEmits<{ request: [] }>();

const eta = ref(12);
let etaTimer: ReturnType<typeof setInterval> | undefined;

watch(
  () => props.screen,
  (screen) => {
    if (etaTimer) clearInterval(etaTimer);
    if (screen === 'trip') {
      eta.value = 12;
      etaTimer = setInterval(() => {
        eta.value = Math.max(1, eta.value - 1);
      }, 700);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => etaTimer && clearInterval(etaTimer));
</script>

<template>
  <PhoneFrame label="Rider">
    <div class="flex flex-1 flex-col">
      <div class="mb-4 space-y-2 rounded-2xl border border-line bg-bg-elevated/60 p-3">
        <div class="flex items-center gap-2 text-sm text-ink">
          <span class="size-2 rounded-full bg-signal-green" />
          7th Circle, Amman
        </div>
        <div class="ml-1 h-3 border-l border-dashed border-line" />
        <div class="flex items-center gap-2 text-sm text-ink">
          <MapPin class="size-3 text-cyan" aria-hidden="true" />
          Abdali Boulevard
        </div>
      </div>

      <div class="relative flex-1 overflow-hidden rounded-2xl border border-line bg-bg">
        <LiveMapDemo
          :phase="screen === 'request' ? 'idle' : screen === 'searching' ? 'searching' : screen === 'tracking' ? 'tracking' : 'route'"
          :eta="screen === 'tracking' ? '3 min away' : screen === 'trip' ? `${eta} min ETA` : ''"
          compact
        />
      </div>

      <div class="mt-4 min-h-[104px]">
        <Transition name="fade-slide" mode="out-in">
          <button
            v-if="screen === 'request'"
            key="request"
            type="button"
            class="w-full rounded-xl bg-gradient-to-r from-cyan to-blue py-3 text-sm font-semibold text-bg transition hover:brightness-110"
            @click="emit('request')"
          >
            Request GeoRide
          </button>

          <div v-else-if="screen === 'searching'" key="searching" class="flex items-center justify-center gap-2 py-3 text-sm text-ink-dim">
            <Search class="size-4 animate-pulse text-cyan" aria-hidden="true" />
            Finding a nearby driver…
          </div>

          <div v-else-if="screen === 'tracking'" key="tracking" class="flex items-center gap-3 rounded-xl border border-line bg-bg-elevated/60 p-3">
            <div class="flex size-10 items-center justify-center rounded-full bg-cyan/15 text-cyan">
              <Car class="size-5" aria-hidden="true" />
            </div>
            <div class="flex-1">
              <p class="flex items-center gap-1 text-sm font-semibold text-ink">
                Omar
                <Star class="size-3 fill-streetlight text-streetlight" aria-hidden="true" />
                4.9
              </p>
              <p class="text-xs text-ink-faint">Toyota Camry · 3 min away</p>
            </div>
          </div>

          <div v-else-if="screen === 'arrived'" key="arrived" class="flex items-center justify-center gap-2 rounded-xl border border-signal-green/30 bg-signal-green/10 py-3 text-sm font-semibold text-signal-green">
            <span class="size-2 rounded-full bg-signal-green" />
            Driver Arrived
          </div>

          <div v-else key="trip" class="flex items-center justify-between rounded-xl border border-line bg-bg-elevated/60 px-4 py-3">
            <span class="flex items-center gap-2 text-sm font-semibold text-ink">
              <Navigation class="size-4 text-cyan" aria-hidden="true" />
              Trip Started
            </span>
            <span class="text-xs text-ink-faint">{{ eta }} min ETA</span>
          </div>
        </Transition>
      </div>
    </div>
  </PhoneFrame>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
