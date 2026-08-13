<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow?: string;
    title: string;
    subtitle?: string;
    align?: 'left' | 'center';
  }>(),
  { align: 'center' },
);
</script>

<template>
  <Reveal :as="'div'" :class="['max-w-3xl', align === 'center' ? 'mx-auto text-center' : 'text-left']">
    <p v-if="eyebrow" class="mb-3 text-xs font-semibold tracking-[0.2em] text-cyan uppercase">
      {{ eyebrow }}
    </p>
    <h2 class="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl lg:text-5xl">
      {{ title }}
    </h2>
    <p v-if="subtitle" class="mt-5 text-lg text-ink-dim">
      {{ subtitle }}
    </p>
  </Reveal>
</template>
