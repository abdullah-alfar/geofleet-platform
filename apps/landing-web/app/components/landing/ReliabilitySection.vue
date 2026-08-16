<script setup lang="ts">
const rootEl = ref<HTMLElement | null>(null);
const isInView = useInView(rootEl, { once: false, threshold: 0.1 });
const prefersReduced = useReducedMotion();
const running = computed(() => isInView.value && !prefersReduced.value);
</script>

<template>
  <section ref="rootEl" class="bg-bg-secondary py-28">
    <div class="mx-auto max-w-6xl px-6">
      <SectionHeading
        eyebrow="Engineering Under the Hood"
        title="Reliability patterns, not happy-path assumptions."
        subtitle="The parts of a distributed system that only matter when something goes wrong."
      />

      <div class="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" :class="{ 'reliability-paused': !running }">
        <!-- Transactional Outbox -->
        <div class="rounded-2xl border border-line bg-bg-elevated/40 p-5">
          <div class="flex h-20 items-center justify-center gap-2">
            <div class="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-center">
              <p class="text-[10px] text-ink-faint">DB TXN</p>
              <p class="text-[10px] font-medium text-cyan">row + outbox</p>
            </div>
            <div class="relative h-px w-8 bg-line">
              <span class="reliability-dot absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-cyan" />
            </div>
            <div class="rounded-lg border border-line px-2.5 py-2 text-[10px] text-ink-dim">Kafka</div>
          </div>
          <h4 class="font-display text-sm font-semibold text-ink">Transactional Outbox</h4>
          <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
            The domain write and its outbox row commit in the same transaction — an event is never published for a
            write that didn't happen.
          </p>
        </div>

        <!-- Inbox Idempotency -->
        <div class="rounded-2xl border border-line bg-bg-elevated/40 p-5">
          <div class="flex h-20 flex-col items-center justify-center gap-1.5">
            <div class="flex items-center gap-2 text-[10px]">
              <span class="rounded bg-bg px-2 py-1 text-ink-dim">event #a1</span>
              <span class="text-signal-green">✓ processed</span>
            </div>
            <div class="reliability-blink flex items-center gap-2 text-[10px]">
              <span class="rounded bg-bg px-2 py-1 text-ink-dim">event #a1</span>
              <span class="text-ink-faint line-through">skipped (duplicate)</span>
            </div>
          </div>
          <h4 class="font-display text-sm font-semibold text-ink">Inbox Idempotency</h4>
          <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
            Every consumer records processed event IDs. At-least-once delivery is assumed everywhere — duplicates
            are expected and safely dropped.
          </p>
        </div>

        <!-- Retry / DLQ -->
        <div class="rounded-2xl border border-line bg-bg-elevated/40 p-5">
          <div class="flex h-20 items-center justify-center gap-1.5">
            <div class="rounded-lg border border-line px-2 py-1.5 text-[10px] text-ink-dim">event</div>
            <span class="reliability-fail-1 text-xs text-streetlight">✕</span>
            <span class="reliability-fail-2 text-xs text-streetlight">✕</span>
            <div class="reliability-divert rounded-lg border border-cyan/40 bg-cyan/10 px-2 py-1.5 text-[10px] text-cyan">
              DLQ
            </div>
          </div>
          <h4 class="font-display text-sm font-semibold text-ink">Retry / DLQ</h4>
          <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
            Failed handlers retry with backoff on a dedicated topic; after the retry budget is spent, the event
            lands in a dead-letter queue instead of blocking the stream.
          </p>
        </div>

        <!-- Atomic Ride Acceptance -->
        <div class="rounded-2xl border border-line bg-bg-elevated/40 p-5">
          <div class="flex h-20 items-center justify-center gap-3">
            <div class="flex flex-col items-center gap-1">
              <span class="reliability-race-a rounded bg-bg px-2 py-1 text-[10px] text-ink-dim">Driver A</span>
              <span class="text-[10px] text-signal-green">✓ won</span>
            </div>
            <div class="rounded-lg border border-line px-2 py-2 text-[10px] text-ink-dim">1 row</div>
            <div class="flex flex-col items-center gap-1">
              <span class="reliability-race-b rounded bg-bg px-2 py-1 text-[10px] text-ink-dim">Driver B</span>
              <span class="text-[10px] text-ink-faint">✕ lost</span>
            </div>
          </div>
          <h4 class="font-display text-sm font-semibold text-ink">Atomic Ride Acceptance</h4>
          <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
            A single conditional update — never a read-then-write — decides the winner. Exactly one row affected
            means exactly one driver won.
          </p>
        </div>

        <!-- Correlation IDs -->
        <div class="rounded-2xl border border-line bg-bg-elevated/40 p-5">
          <div class="flex h-20 flex-col items-center justify-center gap-1.5">
            <div class="reliability-carry flex items-center gap-1.5">
              <code class="rounded bg-cyan/10 px-2 py-0.5 text-[9px] text-cyan">8f3a…</code>
              <span class="text-[10px] text-ink-faint">→ core-api → dispatch → gateway</span>
            </div>
          </div>
          <h4 class="font-display text-sm font-semibold text-ink">Correlation IDs</h4>
          <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
            One ID, generated at the edge, carried through every log line and event envelope a request touches —
            so a single trip can be traced end to end.
          </p>
        </div>

        <!-- Health / Readiness -->
        <div class="rounded-2xl border border-line bg-bg-elevated/40 p-5">
          <div class="flex h-20 items-center justify-center">
            <svg viewBox="0 0 120 40" class="h-10 w-28">
              <polyline
                points="0,20 20,20 28,6 36,34 44,20 60,20 68,10 76,30 84,20 120,20"
                fill="none"
                stroke="#4ade80"
                stroke-width="2"
                class="reliability-heartbeat"
              />
            </svg>
          </div>
          <h4 class="font-display text-sm font-semibold text-ink">Health &amp; Readiness</h4>
          <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
            Every service exposes liveness and readiness endpoints, checked independently — so orchestration knows
            the difference between "starting up" and "actually broken."
          </p>
        </div>

        <!-- Prometheus Metrics -->
        <div class="rounded-2xl border border-line bg-bg-elevated/40 p-5 sm:col-span-2 lg:col-span-1">
          <div class="flex h-20 items-end justify-center gap-2">
            <span v-for="i in 5" :key="i" class="reliability-bar w-3 rounded-t bg-gradient-to-t from-blue to-cyan" :style="{ animationDelay: `${i * 0.15}s` }" />
          </div>
          <h4 class="font-display text-sm font-semibold text-ink">Prometheus Metrics</h4>
          <p class="mt-1.5 text-xs leading-relaxed text-ink-faint">
            Every service exports its own request rates, latencies, and consumer lag — the same signals that would
            page an on-call engineer in production.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.reliability-dot {
  animation: dot-travel 2s ease-in-out infinite;
}
.reliability-blink {
  animation: blink-in 3s ease-in-out infinite;
  animation-delay: 1s;
  opacity: 0;
}
.reliability-fail-1 {
  animation: fail-flash 2.4s ease-in-out infinite;
  animation-delay: 0.3s;
  opacity: 0;
}
.reliability-fail-2 {
  animation: fail-flash 2.4s ease-in-out infinite;
  animation-delay: 0.9s;
  opacity: 0;
}
.reliability-divert {
  animation: divert-in 2.4s ease-in-out infinite;
  animation-delay: 1.5s;
  opacity: 0.3;
}
.reliability-race-a {
  animation: race-pulse 2.4s ease-in-out infinite;
}
.reliability-race-b {
  animation: race-pulse 2.4s ease-in-out infinite reverse;
  opacity: 0.5;
}
.reliability-carry {
  animation: carry-fade 2.6s ease-in-out infinite;
}
.reliability-heartbeat {
  stroke-dasharray: 200;
  stroke-dashoffset: 200;
  animation: heartbeat-draw 2.4s ease-in-out infinite;
}
.reliability-bar {
  animation: bar-grow 1.8s ease-in-out infinite;
}

.reliability-paused * {
  animation-play-state: paused !important;
}

@keyframes dot-travel {
  0%,
  10% {
    left: 0%;
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  90% {
    opacity: 1;
  }
  100% {
    left: 95%;
    opacity: 0;
  }
}
@keyframes blink-in {
  0%,
  20% {
    opacity: 0;
  }
  35%,
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes fail-flash {
  0%,
  100% {
    opacity: 0;
  }
  10%,
  25% {
    opacity: 1;
  }
}
@keyframes divert-in {
  0%,
  55% {
    opacity: 0.3;
    transform: scale(0.95);
  }
  70%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes race-pulse {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(3px);
  }
}
@keyframes carry-fade {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
@keyframes heartbeat-draw {
  0% {
    stroke-dashoffset: 200;
  }
  60% {
    stroke-dashoffset: 0;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 0.4;
  }
}
@keyframes bar-grow {
  0%,
  100% {
    height: 20%;
  }
  50% {
    height: 90%;
  }
}

.reliability-bar:nth-child(1) {
  height: 40%;
}
.reliability-bar:nth-child(2) {
  height: 70%;
}
.reliability-bar:nth-child(3) {
  height: 50%;
}
.reliability-bar:nth-child(4) {
  height: 85%;
}
.reliability-bar:nth-child(5) {
  height: 60%;
}
</style>
