<script setup lang="ts">
const rootEl = ref<HTMLElement | null>(null);
const isInView = useInView(rootEl, { once: false, threshold: 0.15 });
const prefersReduced = useReducedMotion();
const flowActive = computed(() => isInView.value && !prefersReduced.value);

const branches = [
  { name: 'Go Location', sink: 'Redis' },
  { name: 'Go Dispatch', sink: 'PostgreSQL + PostGIS' },
  { name: 'Realtime Gateway', sink: 'WebSockets' },
];

const services = [
  {
    name: 'Laravel 13 Core API',
    owns: ['Users', 'Drivers', 'Vehicles', 'Rides', 'Trips', 'Payments', 'Transactional business rules'],
    reason:
      "Laravel is excellent for transactional business applications, APIs, validation, authentication, and database workflows.",
  },
  {
    name: 'Go Location Service',
    owns: ['GPS ingestion', 'GPS validation', 'Live location updates', 'Kafka location events'],
    reason: 'Designed for high-concurrency and high-throughput realtime workloads.',
  },
  {
    name: 'Go Dispatch Service',
    owns: ['Nearby-driver discovery', 'Driver ranking', 'Ride offers', 'Assignment', 'Race-condition-safe acceptance'],
    reason: 'Can scale independently from GPS ingestion and the core business API.',
  },
  {
    name: 'Go Realtime Gateway',
    owns: ['WebSockets', 'Trip subscriptions', 'Realtime driver movement', 'Realtime status updates'],
    reason: 'Handles large numbers of long-lived concurrent connections efficiently.',
  },
  {
    name: 'NestJS Admin API',
    owns: ['Admin BFF', 'Operational query aggregation', 'Command forwarding to core-api', 'Live driver/region views'],
    reason:
      "Reads and writes through core-api's own internal API synchronously — no Kafka, no projection lag. Admin traffic is low-volume enough that a direct call is simpler than an eventually-consistent read model.",
  },
];
</script>

<template>
  <section id="architecture" ref="rootEl" class="relative overflow-hidden bg-bg-secondary py-28">
    <div class="mx-auto max-w-6xl px-6">
      <SectionHeading
        eyebrow="Behind the Experience"
        title="A simple ride on the surface. A distributed system underneath."
        subtitle="Every screen in the demo above is backed by a real event-driven architecture — four services on one event bus, plus an admin surface that reads the core API directly instead."
      />

      <Reveal :delay="120" class="mt-16 rounded-3xl border border-line bg-bg/60 p-6 sm:p-10">
        <div class="mx-auto flex max-w-xs flex-col items-center text-center">
          <ArchNode label="Rider / Driver Apps" />
          <FlowConnector :active="flowActive" :delay="0" />
          <ArchNode label="Laravel 13 Core API" accent />
          <FlowConnector :active="flowActive" :delay="0.3" />
          <ArchNode label="Transactional Outbox" subtle />
          <FlowConnector :active="flowActive" :delay="0.6" />
          <ArchNode label="Apache Kafka" accent />
          <FlowConnector :active="flowActive" :delay="0.9" height="1.5rem" />
        </div>

        <!-- Fan-out manifold -->
        <div class="relative mx-auto hidden max-w-2xl sm:block">
          <div class="h-px bg-line" />
          <div class="grid grid-cols-3">
            <div v-for="(b, i) in branches" :key="b.name" class="relative mx-auto">
              <FlowConnector :active="flowActive" :delay="0.9 + i * 0.15" height="1.5rem" />
            </div>
          </div>
        </div>

        <div class="mx-auto grid max-w-2xl grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div v-for="(b, i) in branches" :key="b.name" class="flex flex-col items-center text-center">
            <ArchNode :label="b.name" compact />
            <FlowConnector :active="flowActive" :delay="1.2 + i * 0.15" />
            <ArchNode :label="b.sink" compact subtle />
          </div>
        </div>
      </Reveal>

      <!-- Admin path: synchronous HTTP off core-api, deliberately not on the Kafka bus above -->
      <Reveal :delay="160" class="mt-8 rounded-3xl border border-line bg-bg/60 p-6 sm:p-8">
        <p class="mb-6 text-center text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">
          Admin path — direct HTTP, not Kafka
        </p>
        <div class="mx-auto flex max-w-xs flex-col items-center text-center sm:max-w-none sm:flex-row sm:justify-center sm:gap-0">
          <ArchNode label="Laravel 13 Core API" accent compact />
          <div class="flex flex-col items-center sm:mx-4">
            <FlowConnector :active="flowActive" :delay="0" height="1.25rem" class="sm:hidden" />
            <span class="hidden text-[10px] whitespace-nowrap text-ink-faint sm:block">internal/v1 API →</span>
          </div>
          <ArchNode label="NestJS Admin API" compact />
          <div class="flex flex-col items-center sm:mx-4">
            <FlowConnector :active="flowActive" :delay="0.2" height="1.25rem" class="sm:hidden" />
            <span class="hidden text-[10px] whitespace-nowrap text-ink-faint sm:block">→</span>
          </div>
          <ArchNode label="Nuxt 4 Admin Dashboard" compact subtle />
        </div>
        <p class="mx-auto mt-6 max-w-lg text-center text-xs leading-relaxed text-ink-faint">
          Admin traffic isn't heavy enough to justify the eventual-consistency trade-off a Kafka-projected read
          model buys — so this path reads and writes through core-api's own API directly instead.
        </p>
      </Reveal>

      <Reveal :delay="220" class="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="svc in services" :key="svc.name" class="rounded-2xl border border-line bg-bg-elevated/40 p-5">
          <h4 class="font-display text-sm font-semibold text-ink">{{ svc.name }}</h4>
          <ul class="mt-3 space-y-1">
            <li v-for="item in svc.owns" :key="item" class="flex items-start gap-1.5 text-xs text-ink-dim">
              <span class="mt-1.5 size-1 shrink-0 rounded-full bg-cyan" />
              {{ item }}
            </li>
          </ul>
          <p class="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">{{ svc.reason }}</p>
        </div>
      </Reveal>
    </div>
  </section>
</template>
