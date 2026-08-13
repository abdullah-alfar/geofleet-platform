/** Normalized (-1..1) pointer position within `target`, eased toward on read by the caller. */
export function useMouseParallax(target: Ref<HTMLElement | null | undefined>) {
  const x = ref(0);
  const y = ref(0);

  function onMove(e: PointerEvent) {
    const el = target.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    x.value = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    y.value = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  }

  function onLeave() {
    x.value = 0;
    y.value = 0;
  }

  onMounted(() => {
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerleave', onLeave);
  });

  return { x, y };
}
