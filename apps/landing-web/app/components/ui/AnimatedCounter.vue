<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    to: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    duration?: number;
  }>(),
  { prefix: '', suffix: '', decimals: 0, duration: 1.6 },
);

const el = ref<HTMLElement | null>(null);
const isInView = useInView(el, { once: true, threshold: 0.5 });
const prefersReduced = useReducedMotion();
const display = ref('0');

function format(n: number) {
  return `${props.prefix}${n.toLocaleString('en-US', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  })}${props.suffix}`;
}

watch(isInView, (visible) => {
  if (!visible) return;
  if (prefersReduced.value) {
    display.value = format(props.to);
    return;
  }
  const { gsap } = useGsap();
  const proxy = { value: 0 };
  gsap.to(proxy, {
    value: props.to,
    duration: props.duration,
    ease: 'power2.out',
    onUpdate: () => {
      display.value = format(proxy.value);
    },
  });
});
</script>

<template>
  <span ref="el">{{ display }}</span>
</template>
