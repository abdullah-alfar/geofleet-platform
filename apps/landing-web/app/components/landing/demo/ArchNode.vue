<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    accent?: boolean;
    subtle?: boolean;
    compact?: boolean;
  }>(),
  { accent: false, subtle: false, compact: false },
);
</script>

<template>
  <div
    class="w-full rounded-xl border text-center font-medium transition"
    :class="[
      compact ? 'px-3 py-2 text-xs' : 'px-5 py-3 text-sm',
      accent
        ? 'border-cyan/40 bg-cyan/10 text-cyan'
        : subtle
          ? 'border-line/70 bg-transparent text-ink-faint'
          : 'border-line bg-bg-elevated text-ink',
    ]"
  >
    {{ label }}
  </div>
</template>
