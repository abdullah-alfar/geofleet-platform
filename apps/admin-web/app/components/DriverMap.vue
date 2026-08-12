<script setup lang="ts">
import type { LiveDriverPosition } from '~/types/realtime';

/**
 * A plain auto-fit SVG scatter plot, not a real map (no tiles, no
 * street/geography context) — deliberately avoids pulling in a mapping
 * SDK (Leaflet/Mapbox, API keys, tile servers) for what's still an
 * internal tool's first pass at this view. Good enough to see relative
 * driver positions and availability at a glance; upgrade to a real map
 * library if this needs actual geographic context later.
 */
const props = defineProps<{ drivers: LiveDriverPosition[] }>();

const VIEW_SIZE = 400;
const PADDING = 20;

const points = computed(() => {
  if (props.drivers.length === 0) return [];

  const lats = props.drivers.map((d) => d.latitude);
  const lngs = props.drivers.map((d) => d.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Guards a zero-size bounding box (all drivers clustered at ~one point).
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const span = VIEW_SIZE - 2 * PADDING;

  return props.drivers.map((driver) => ({
    ...driver,
    x: PADDING + ((driver.longitude - minLng) / lngRange) * span,
    // Latitude increases northward; SVG y increases downward — flip it.
    y: PADDING + (1 - (driver.latitude - minLat) / latRange) * span,
  }));
});
</script>

<template>
  <svg :viewBox="`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`" class="w-full rounded-lg border border-slate-200 bg-slate-50">
    <circle
      v-for="point in points"
      :key="point.driver_id"
      :cx="point.x"
      :cy="point.y"
      r="5"
      :fill="point.is_available ? '#16a34a' : '#94a3b8'"
      stroke="white"
      stroke-width="1.5"
    >
      <title>{{ point.name ?? point.driver_id }} — {{ point.is_available ? 'available' : 'busy' }}</title>
    </circle>
    <text
      v-if="points.length === 0"
      x="50%"
      y="50%"
      text-anchor="middle"
      class="fill-slate-400 text-sm"
    >
      No live positions in this region right now.
    </text>
  </svg>
</template>
