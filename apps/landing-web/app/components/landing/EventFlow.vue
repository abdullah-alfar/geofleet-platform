<script setup lang="ts">
const rootEl = ref<HTMLElement | null>(null);
const isInView = useInView(rootEl, { once: false, threshold: 0.25 });
const prefersReduced = useReducedMotion();
const flowActive = computed(() => isInView.value && !prefersReduced.value);

const consumers = ['Realtime Gateway', 'Dispatch Service', 'Core API · history'];
</script>

<template>
  <section ref="rootEl" class="bg-bg py-28">
    <div class="mx-auto max-w-4xl px-6">
      <SectionHeading eyebrow="Event-Driven by Design" title="One event, three systems, zero tight coupling." />

      <Reveal :delay="100" class="mt-8 flex justify-center">
        <code class="rounded-full border border-line bg-bg-elevated/60 px-4 py-1.5 text-sm text-cyan">
          driver.location.validated.v1
        </code>
      </Reveal>

      <Reveal :delay="180" class="mt-14 rounded-3xl border border-line bg-bg-secondary/60 p-6 sm:p-10">
        <div class="mx-auto flex max-w-xs flex-col items-center text-center">
          <ArchNode label="Driver phone" />
          <FlowConnector :active="flowActive" :delay="0" />
          <ArchNode label="Go Location Service" accent />
          <FlowConnector :active="flowActive" :delay="0.3" />
          <ArchNode label="Redis · latest location" subtle />
          <FlowConnector :active="flowActive" :delay="0.6" />
          <ArchNode label="Kafka" accent />
          <FlowConnector :active="flowActive" :delay="0.9" height="1.5rem" />
        </div>

        <div class="relative mx-auto hidden max-w-2xl sm:block">
          <div class="h-px bg-line" />
          <div class="grid grid-cols-3">
            <div v-for="(c, i) in consumers" :key="c" class="relative mx-auto">
              <FlowConnector :active="flowActive" :delay="0.9 + i * 0.15" height="1.5rem" />
            </div>
          </div>
        </div>

        <div class="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
          <ArchNode v-for="c in consumers" :key="c" :label="c" compact />
        </div>
      </Reveal>

      <Reveal :delay="240">
        <p class="mx-auto mt-10 max-w-xl text-center text-ink-dim">
          One GPS update simultaneously refreshes the live map, updates dispatch's driver index, and extends the
          trip's durable route history — without those three systems ever calling each other directly.
        </p>
      </Reveal>
    </div>
  </section>
</template>
