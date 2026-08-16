<script setup lang="ts">
const STAGES = ['Requested', 'Matching', 'Driver Assigned', 'Driver Arriving', 'Trip Started', 'Completed'];

const rootEl = ref<HTMLElement | null>(null);
const isInView = useInView(rootEl, { once: true, threshold: 0.4 });
const prefersReduced = useReducedMotion();
const activeCount = ref(0);

watch(isInView, (visible) => {
  if (!visible) return;
  if (prefersReduced.value) {
    activeCount.value = STAGES.length;
    return;
  }
  let i = 0;
  const timer = setInterval(() => {
    i += 1;
    activeCount.value = i;
    if (i >= STAGES.length) clearInterval(timer);
  }, 260);
});
</script>

<template>
  <div ref="rootEl" class="rounded-2xl border border-line bg-bg-elevated/40 p-6 sm:p-8">
    <!-- Vertical timeline (mobile) -->
    <ol class="flex flex-col sm:hidden">
      <li v-for="(stage, i) in STAGES" :key="stage" class="flex gap-3">
        <div class="flex flex-col items-center">
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-500"
            :class="i < activeCount ? 'border-cyan bg-cyan text-bg' : 'border-line text-ink-faint'"
          >
            {{ i + 1 }}
          </span>
          <span
            v-if="i < STAGES.length - 1"
            class="my-1 w-px flex-1 transition-colors duration-500"
            :class="i < activeCount - 1 ? 'bg-cyan' : 'bg-line'"
          />
        </div>
        <p class="pb-6 pt-1 text-sm transition-colors duration-500" :class="i < activeCount ? 'text-ink' : 'text-ink-faint'">
          {{ stage }}
        </p>
      </li>
    </ol>

    <!-- Horizontal timeline (desktop) -->
    <ol class="hidden sm:flex sm:items-start">
      <li v-for="(stage, i) in STAGES" :key="stage" class="flex flex-1 flex-col items-center last:flex-none">
        <div class="flex w-full items-center">
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-500"
            :class="i < activeCount ? 'border-cyan bg-cyan text-bg' : 'border-line text-ink-faint'"
          >
            {{ i + 1 }}
          </span>
          <span
            v-if="i < STAGES.length - 1"
            class="mt-0 h-px flex-1 transition-colors duration-500"
            :class="i < activeCount - 1 ? 'bg-cyan' : 'bg-line'"
          />
        </div>
        <p
          class="mt-3 max-w-[6.5rem] text-center text-xs transition-colors duration-500"
          :class="i < activeCount ? 'text-ink' : 'text-ink-faint'"
        >
          {{ stage }}
        </p>
      </li>
    </ol>
  </div>
</template>
