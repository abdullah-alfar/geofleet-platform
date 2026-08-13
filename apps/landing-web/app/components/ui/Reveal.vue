<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    as?: string;
    delay?: number;
    y?: number;
    once?: boolean;
  }>(),
  { as: 'div', delay: 0, y: 24, once: true },
);

const el = ref<HTMLElement | null>(null);
const isInView = useInView(el, { once: props.once });
const prefersReduced = useReducedMotion();
</script>

<template>
  <component
    :is="as"
    ref="el"
    :style="{
      transitionDelay: `${delay}ms`,
      transform: !prefersReduced && !isInView ? `translateY(${y}px)` : 'translateY(0)',
      opacity: isInView || prefersReduced ? 1 : 0,
    }"
    class="transition-[opacity,transform] duration-700 ease-out will-change-transform"
  >
    <slot />
  </component>
</template>
