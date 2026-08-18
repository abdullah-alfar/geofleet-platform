<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MaplibreMap, Marker, GeoJSONSource } from 'maplibre-gl';
import type { DriverTrace } from '~/types/realtime';

/**
 * A real street map (MapLibre GL + OpenStreetMap raster tiles — free,
 * no API key/token needed, unlike Google Maps/Mapbox) tracking one
 * driver, Uber-rider-screen style: a marker that glides between polls
 * plus a fading trail of recent positions. Polls admin-api's per-driver
 * endpoint (not the region map, which re-fetches every driver in the
 * region on every tick — too heavy for a screen that only cares about
 * one) at a cadence comfortably under its 60/min throttle.
 */
const props = defineProps<{ driverId: string }>();

const POLL_MS = 2500;
const TRAIL_MAX_POINTS = 60;

// A raw OSM tile source needs no API key/token at all — the tradeoff
// against Mapbox/Google is usage-policy politeness (light load only,
// no heavy caching), which is exactly this internal admin tool's traffic
// profile. See docs/admin-web note if this ever needs production-scale
// traffic — self-hosted tiles or a paid provider would be the upgrade.
const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

const api = useAdminApi();
const trace = ref<DriverTrace | null>(null);
const error = ref<string | null>(null);
const following = ref(true);

const mapContainer = ref<HTMLDivElement | null>(null);
let map: MaplibreMap | null = null;
let marker: Marker | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;
const trail: [number, number][] = [];

function updateTrail() {
  const source = map?.getSource('trail') as GeoJSONSource | undefined;
  source?.setData({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: trail },
  });
}

async function poll() {
  try {
    trace.value = await api.get<DriverTrace>(
      `/api/v1/admin/realtime/drivers/${props.driverId}`,
    );
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load live position.';
    return;
  }

  if (!map || trace.value.latitude === null || trace.value.longitude === null) return;
  const lngLat: [number, number] = [trace.value.longitude, trace.value.latitude];

  if (!marker) {
    const { Marker: MarkerCtor } = await import('maplibre-gl');
    marker = new MarkerCtor({ color: trace.value.is_available ? '#16a34a' : '#2563eb' })
      .setLngLat(lngLat)
      .addTo(map);
    map.jumpTo({ center: lngLat, zoom: 15 });
  } else {
    // The marker's own DOM element transitions its transform smoothly
    // (see the CSS below) — this plus easeTo on the camera is what gives
    // the "gliding" feel between polls instead of a pin that teleports.
    marker.setLngLat(lngLat);
    if (following.value) {
      map.easeTo({ center: lngLat, duration: POLL_MS * 0.9 });
    }
  }

  trail.push(lngLat);
  if (trail.length > TRAIL_MAX_POINTS) trail.shift();
  updateTrail();
}

onMounted(async () => {
  if (!mapContainer.value) return;
  const { Map: MaplibreMapCtor } = await import('maplibre-gl');

  map = new MaplibreMapCtor({
    container: mapContainer.value,
    style: OSM_STYLE,
    center: [35.9106, 31.9539], // Amman, until the first poll resolves
    zoom: 12,
  });

  map.on('load', () => {
    map!.addSource('trail', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    });
    map!.addLayer({
      id: 'trail',
      type: 'line',
      source: 'trail',
      paint: { 'line-color': '#2563eb', 'line-width': 3, 'line-opacity': 0.6 },
    });
  });

  // Manual pan/zoom drops auto-follow, same affordance Uber's own
  // tracking screen gives — a "Recenter" button brings it back.
  map.on('dragstart', () => {
    following.value = false;
  });

  poll();
  pollTimer = setInterval(poll, POLL_MS);
});

onUnmounted(() => {
  clearInterval(pollTimer);
  map?.remove();
});

function recenter() {
  following.value = true;
  if (map && trace.value?.latitude != null && trace.value?.longitude != null) {
    map.easeTo({ center: [trace.value.longitude, trace.value.latitude], zoom: 15 });
  }
}
</script>

<template>
  <div>
    <div class="mb-2 flex items-center justify-between">
      <span class="text-sm text-slate-500">
        <template v-if="trace?.online">
          Live — updated {{ new Date(trace.updated_at!).toLocaleTimeString() }}
        </template>
        <template v-else-if="trace">
          Driver offline (no recent GPS ping)
        </template>
        <template v-else> Loading… </template>
      </span>
      <button
        v-if="!following"
        type="button"
        class="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        @click="recenter"
      >
        Recenter
      </button>
    </div>
    <p v-if="error" class="mb-2 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</p>
    <div ref="mapContainer" class="h-96 w-full overflow-hidden rounded-lg border border-slate-200 [&_.maplibregl-marker]:transition-transform [&_.maplibregl-marker]:duration-[2200ms] [&_.maplibregl-marker]:ease-linear" />
  </div>
</template>
