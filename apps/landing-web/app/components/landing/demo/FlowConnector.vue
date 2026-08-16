<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean; delay?: number; height?: string }>(), {
  active: true,
  delay: 0,
  height: '2rem',
});
</script>

<template>
  <div class="relative mx-auto w-px bg-line" :style="{ height }">
    <span
      v-if="active"
      class="absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-cyan shadow-[0_0_8px_theme(colors.cyan)]"
      :style="{ animation: `flow-down 1.8s ease-in infinite`, animationDelay: `${delay}s` }"
    />
  </div>
</template>

<style scoped>
@keyframes flow-down {
  0% {
    top: 0%;
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  85% {
    opacity: 1;
  }
  100% {
    top: 100%;
    opacity: 0;
  }
}
</style>
