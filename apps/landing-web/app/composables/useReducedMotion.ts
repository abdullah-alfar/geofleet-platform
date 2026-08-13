export function useReducedMotion() {
  const prefersReduced = ref(false);

  onMounted(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReduced.value = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      prefersReduced.value = e.matches;
    };
    mq.addEventListener('change', onChange);
    onScopeDispose(() => mq.removeEventListener('change', onChange));
  });

  return prefersReduced;
}
