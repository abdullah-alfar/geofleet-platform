<script setup lang="ts">
const groups = [
  { title: 'Core', items: ['Laravel 13', 'PHP', 'Go', 'NestJS', 'Nuxt 4'] },
  { title: 'Data', items: ['PostgreSQL', 'PostGIS', 'Redis'] },
  { title: 'Events & Realtime', items: ['Apache Kafka', 'WebSockets'] },
  { title: 'Engineering', items: ['Docker', 'Jenkins', 'Prometheus', 'Clean Architecture', 'Design Patterns'] },
];
</script>

<template>
  <section class="bg-bg-secondary py-28">
    <div class="mx-auto max-w-6xl px-6">
      <SectionHeading eyebrow="Technology Stack" title="A deliberate, not default, set of tools." />

      <Reveal :delay="120" class="mt-16 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="group in groups" :key="group.title">
          <p class="text-xs font-semibold tracking-[0.2em] text-cyan uppercase">{{ group.title }}</p>
          <ul class="mt-4 space-y-2.5">
            <li v-for="item in group.items" :key="item" class="text-sm text-ink-dim">{{ item }}</li>
          </ul>
        </div>
      </Reveal>
    </div>
  </section>
</template>
