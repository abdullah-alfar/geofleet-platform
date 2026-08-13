export interface UseInViewOptions {
  /** Stop observing after the first time the element becomes visible. */
  once?: boolean;
  /** Fraction of the element that must be visible to count as "in view". */
  threshold?: number;
  /** Shrinks/grows the viewport box used for intersection, e.g. to fire slightly early. */
  rootMargin?: string;
}

/** IntersectionObserver-backed visibility flag — the cheap default for scroll reveals. */
export function useInView(target: Ref<HTMLElement | null | undefined>, options: UseInViewOptions = {}) {
  const isInView = ref(false);
  const { once = true, threshold = 0.2, rootMargin = '0px 0px -10% 0px' } = options;

  let observer: IntersectionObserver | null = null;

  onMounted(() => {
    if (!target.value) return;
    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          isInView.value = true;
          if (once) observer?.disconnect();
        } else if (!once) {
          isInView.value = false;
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(target.value);
  });

  onBeforeUnmount(() => observer?.disconnect());

  return isInView;
}
