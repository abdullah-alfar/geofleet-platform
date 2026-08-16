<script setup lang="ts">
import { Github, Mail } from 'lucide-vue-next';
</script>

<template>
  <section class="relative overflow-hidden bg-bg py-32">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(0,242,254,0.1),transparent)]" />
    <div class="relative mx-auto max-w-3xl px-6 text-center">
      <Reveal>
        <h2 class="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Built for movement. <span class="text-gradient">Engineered for scale.</span>
        </h2>
      </Reveal>
      <Reveal :delay="100">
        <p class="mx-auto mt-6 max-w-xl text-lg text-ink-dim">
          GeoFleet demonstrates how realtime location, event-driven architecture, distributed services, and
          resilient backend design come together in one platform.
        </p>
      </Reveal>
      <Reveal :delay="200" class="mt-10 flex flex-wrap items-center justify-center gap-4">
        <a
          href="https://github.com/abdullah-alfar"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan to-blue px-6 py-3 text-sm font-semibold text-bg transition hover:brightness-110"
        >
          <Github class="size-4" aria-hidden="true" />
          View Source
        </a>
        <a
          href="mailto:abood.elfar@yahoo.com"
          class="inline-flex items-center gap-2 rounded-full border border-line bg-bg-elevated/50 px-6 py-3 text-sm font-semibold text-ink transition hover:border-ink-faint"
        >
          <Mail class="size-4" aria-hidden="true" />
          Contact Engineer
        </a>
      </Reveal>
    </div>
  </section>
</template>
