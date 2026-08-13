/** Tracks document.visibilityState so heavy render loops (WebGL) can pause on a hidden tab. */
export function usePageVisible() {
  const isVisible = ref(true);

  onMounted(() => {
    isVisible.value = document.visibilityState === 'visible';
    const onChange = () => {
      isVisible.value = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onChange);
    onScopeDispose(() => document.removeEventListener('visibilitychange', onChange));
  });

  return isVisible;
}
