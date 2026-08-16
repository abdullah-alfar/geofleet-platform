<script setup lang="ts">
import { CheckCircle2, MapPin, Navigation } from 'lucide-vue-next';

export type DriverScreen = 'incoming' | 'accepted';

defineProps<{ screen: DriverScreen }>();
const emit = defineEmits<{ accept: [] }>();
</script>

<template>
  <PhoneFrame label="Driver">
    <div class="flex flex-1 flex-col">
      <div class="mb-4 flex items-center justify-between rounded-2xl border border-line bg-bg-elevated/60 p-3">
        <span class="text-sm font-medium text-ink">New ride request</span>
        <span class="rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-cyan">1.2 km</span>
      </div>

      <div class="flex-1 space-y-3 rounded-2xl border border-line bg-bg p-4">
        <div class="flex items-start gap-2 text-sm text-ink">
          <span class="mt-0.5 size-2 shrink-0 rounded-full bg-signal-green" />
          <div>
            <p class="text-xs text-ink-faint">Pickup</p>
            <p>7th Circle, Amman</p>
          </div>
        </div>
        <div class="ml-1 h-4 border-l border-dashed border-line" />
        <div class="flex items-start gap-2 text-sm text-ink">
          <MapPin class="mt-0.5 size-3 shrink-0 text-cyan" aria-hidden="true" />
          <div>
            <p class="text-xs text-ink-faint">Destination</p>
            <p>Abdali Boulevard</p>
          </div>
        </div>

        <div class="mt-4 flex items-center gap-2 rounded-xl bg-bg-elevated/60 p-3 text-xs text-ink-dim">
          <Navigation class="size-3.5 text-blue" aria-hidden="true" />
          Estimated fare · 4.20 JOD
        </div>
      </div>

      <div class="mt-4 min-h-[52px]">
        <Transition name="fade-slide" mode="out-in">
          <button
            v-if="screen === 'incoming'"
            key="incoming"
            type="button"
            class="w-full rounded-xl bg-gradient-to-r from-signal-green to-cyan py-3 text-sm font-semibold text-bg transition hover:brightness-110"
            @click="emit('accept')"
          >
            Accept Ride
          </button>
          <div
            v-else
            key="accepted"
            class="flex items-center justify-center gap-2 rounded-xl border border-signal-green/30 bg-signal-green/10 py-3 text-sm font-semibold text-signal-green"
          >
            <CheckCircle2 class="size-4" aria-hidden="true" />
            Ride accepted
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
