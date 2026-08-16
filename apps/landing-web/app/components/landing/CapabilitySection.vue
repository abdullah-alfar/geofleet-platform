<script setup lang="ts"></script>

<template>
  <section id="capabilities" class="bg-bg py-28">
    <div class="mx-auto max-w-6xl px-6">
      <SectionHeading
        eyebrow="Product Capabilities"
        title="Everything a modern mobility platform needs."
        subtitle="Four systems working together — visible to riders, drivers, and the operators keeping the fleet running."
      />

      <div class="mt-20 space-y-24">
        <!-- Realtime Tracking -->
        <Reveal class="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p class="text-xs font-semibold tracking-[0.2em] text-cyan uppercase">Realtime Tracking</p>
            <h3 class="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl">
              See every active vehicle move live.
            </h3>
            <p class="mt-4 max-w-md text-ink-dim">
              Every driver's location streams in continuously, so the map — and everyone watching it — always
              reflects what's happening right now, not a stale snapshot from a few seconds ago.
            </p>
          </div>
          <div class="rounded-2xl border border-line bg-bg-elevated/40 p-4">
            <LiveMapDemo />
          </div>
        </Reveal>

        <!-- Intelligent Dispatch -->
        <Reveal class="grid items-center gap-10 lg:grid-cols-2">
          <div class="order-2 lg:order-1">
            <DispatchCandidates />
          </div>
          <div class="order-1 lg:order-2">
            <p class="text-xs font-semibold tracking-[0.2em] text-cyan uppercase">Intelligent Dispatch</p>
            <h3 class="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl">
              Connect riders with the right nearby driver.
            </h3>
            <p class="mt-4 max-w-md text-ink-dim">
              Nearby drivers are ranked by distance and ETA the moment a ride is requested. One offer goes out,
              one driver wins — no double-bookings, no manual sorting.
            </p>
          </div>
        </Reveal>

        <!-- Fleet Operations -->
        <Reveal class="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p class="text-xs font-semibold tracking-[0.2em] text-cyan uppercase">Fleet Operations</p>
            <h3 class="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl">
              Monitor drivers, trips, and activity from one view.
            </h3>
            <p class="mt-4 max-w-md text-ink-dim">
              Operators get a live operational picture — active drivers, trips in progress, and regional load —
              without digging through raw tables.
            </p>
          </div>
          <FleetOpsMockup />
        </Reveal>

        <!-- Ride Lifecycle -->
        <Reveal>
          <p class="text-center text-xs font-semibold tracking-[0.2em] text-cyan uppercase">Reliable Ride Lifecycle</p>
          <h3 class="mt-3 text-center font-display text-2xl font-bold text-ink sm:text-3xl">
            Every trip follows the same predictable path.
          </h3>
          <div class="mt-10">
            <RideLifecycle />
          </div>
        </Reveal>
      </div>
    </div>
  </section>
</template>
