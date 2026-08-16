<script setup lang="ts">
const stats = [
  { to: 10, suffix: 'M+', label: 'Platform users', hint: 'Design target' },
  { to: 100, suffix: 'K+', label: 'Online drivers', hint: 'Design target' },
  { to: 20, suffix: 'K/sec', label: 'Possible GPS updates', hint: 'Load-tested capacity' },
  { to: 0, suffix: '', label: 'WebSocket delivery', hint: 'Architecture property', display: 'Realtime' },
];
</script>

<template>
  <section class="relative overflow-hidden bg-bg py-28">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(0,242,254,0.08),transparent)]" />

    <div class="relative mx-auto max-w-6xl px-6">
      <SectionHeading
        eyebrow="Built to Scale"
        title="Designed for fleets far larger than one city."
        subtitle="The numbers below are architecture capacity targets and load-tested design scenarios — not live production metrics from a running fleet."
      />

      <Reveal :delay="120" class="mt-16 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <div
          v-for="s in stats"
          :key="s.label"
          class="rounded-2xl border border-line bg-bg-elevated/40 px-6 py-8 text-center"
        >
          <p
            class="font-display font-bold text-gradient"
            :class="s.display ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'"
          >
            <template v-if="s.display">{{ s.display }}</template>
            <AnimatedCounter v-else :to="s.to" :suffix="s.suffix" />
          </p>
          <p class="mt-2 text-sm text-ink-dim">{{ s.label }}</p>
          <p class="mt-1 text-[11px] tracking-wide text-ink-faint uppercase">{{ s.hint }}</p>
        </div>
      </Reveal>
    </div>
  </section>
</template>
