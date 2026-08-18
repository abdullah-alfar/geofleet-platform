<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MaplibreMap, Marker, GeoJSONSource } from 'maplibre-gl';

/**
 * The Uber-rider-screen piece: a real street map (MapLibre GL + OSM
 * raster tiles — free, no API key/token) with the assigned driver's
 * marker gliding to each new position as it arrives. Unlike admin-web's
 * DriverLiveMap (which polls admin-api every few seconds), this one is
 * purely reactive to `latitude`/`longitude` props — the parent page
 * updates them straight from realtime-gateway's WebSocket push
 * (useCustomerSocket), so there's no polling in this component at all.
 */
const props = defineProps<{ latitude: number | null; longitude: number | null }>();

const TRAIL_MAX_POINTS = 60;

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

const mapContainer = ref<HTMLDivElement | null>(null);
let map: MaplibreMap | null = null;
let marker: Marker | null = null;
const trail: [number, number][] = [];

function updateTrail() {
  const source = map?.getSource('trail') as GeoJSONSource | undefined;
  source?.setData({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: trail },
  });
}

async function applyPosition(lat: number, lng: number) {
  if (!map) return;
  const lngLat: [number, number] = [lng, lat];

  if (!marker) {
    const { Marker: MarkerCtor } = await import('maplibre-gl');
    marker = new MarkerCtor({ color: '#2563eb' }).setLngLat(lngLat).addTo(map);
    map.jumpTo({ center: lngLat, zoom: 15 });
  } else {
    marker.setLngLat(lngLat);
    map.easeTo({ center: lngLat, duration: 1800 });
  }

  trail.push(lngLat);
  if (trail.length > TRAIL_MAX_POINTS) trail.shift();
  updateTrail();
}

watch(
  () => [props.latitude, props.longitude],
  ([lat, lng]) => {
    if (lat !== null && lng !== null) {
      applyPosition(lat, lng);
    }
  },
);

onMounted(async () => {
  if (!mapContainer.value) return;
  const { Map: MaplibreMapCtor } = await import('maplibre-gl');

  map = new MaplibreMapCtor({
    container: mapContainer.value,
    style: OSM_STYLE,
    center:
      props.latitude !== null && props.longitude !== null
        ? [props.longitude, props.latitude]
        : [35.9106, 31.9539], // Amman, until the first position arrives
    zoom: 13,
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

    if (props.latitude !== null && props.longitude !== null) {
      applyPosition(props.latitude, props.longitude);
    }
  });
});

onUnmounted(() => {
  map?.remove();
});
</script>

<template>
  <div ref="mapContainer" class="h-80 w-full overflow-hidden rounded-lg border border-slate-200 [&_.maplibregl-marker]:transition-transform [&_.maplibregl-marker]:duration-[1600ms] [&_.maplibregl-marker]:ease-linear" />
</template>
