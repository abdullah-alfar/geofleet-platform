<script setup lang="ts">
import { Github, Mail, MapPin } from 'lucide-vue-next';

const year = new Date().getFullYear();
</script>

<template>
  <footer class="border-t border-line bg-bg-secondary py-12">
    <div class="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-center sm:flex-row sm:justify-between sm:text-left">
      <div>
        <p class="font-display text-sm font-semibold text-ink">Designed &amp; Engineered by Abdullah Alfar</p>
        <p class="mt-1 text-xs text-ink-faint">Senior Backend Engineer &amp; Team Lead</p>
      </div>

      <div class="flex flex-col items-center gap-3 sm:items-end">
        <div class="flex items-center gap-4 text-sm text-ink-dim">
          <a
            href="https://github.com/abdullah-alfar"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 transition hover:text-ink"
          >
            <Github class="size-4" aria-hidden="true" />
            GitHub
          </a>
          <a href="mailto:abood.elfar@yahoo.com" class="inline-flex items-center gap-1.5 transition hover:text-ink">
            <Mail class="size-4" aria-hidden="true" />
            Email
          </a>
          <span class="inline-flex items-center gap-1.5 text-ink-faint">
            <MapPin class="size-4" aria-hidden="true" />
            Amman, Jordan
          </span>
        </div>
        <p class="text-xs text-ink-faint">&copy; {{ year }} GeoFleet Platform. A portfolio project.</p>
      </div>
    </div>
  </footer>
</template>
