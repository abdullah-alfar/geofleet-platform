<script setup lang="ts">
import type { Incident, RegionDriverMap, RegionLiveCounters } from '~/types/realtime';

/** Polling intervals stay comfortably under admin-api's own per-route
 * throttle limits (Phase 7 — 20/min on the driver map, 30/min on
 * counters/incidents) rather than polling as fast as the throttle
 * technically allows. */
const DRIVER_MAP_POLL_MS = 5000;
const COUNTERS_POLL_MS = 4000;
const INCIDENTS_POLL_MS = 10000;

const api = useAdminApi();
const region = ref('amman');

const driverMap = ref<RegionDriverMap | null>(null);
const driverMapError = ref<string | null>(null);
const counters = ref<RegionLiveCounters | null>(null);
const countersError = ref<string | null>(null);
const incidents = ref<Incident[]>([]);
const incidentsError = ref<string | null>(null);

async function loadDriverMap() {
  try {
    driverMap.value = await api.get<RegionDriverMap>(
      `/api/v1/admin/realtime/regions/${region.value}/drivers`,
    );
    driverMapError.value = null;
  } catch (e) {
    driverMapError.value = e instanceof Error ? e.message : 'Failed to load driver map.';
  }
}

async function loadCounters() {
  try {
    counters.value = await api.get<RegionLiveCounters>(
      `/api/v1/admin/realtime/regions/${region.value}/counters`,
    );
    countersError.value = null;
  } catch (e) {
    countersError.value = e instanceof Error ? e.message : 'Failed to load counters.';
  }
}

async function loadIncidents() {
  try {
    incidents.value = await api.get<Incident[]>('/api/v1/admin/realtime/incidents');
    incidentsError.value = null;
  } catch (e) {
    incidentsError.value = e instanceof Error ? e.message : 'Failed to load incidents.';
  }
}

function onRegionChange() {
  loadDriverMap();
  loadCounters();
}

let driverMapTimer: ReturnType<typeof setInterval> | undefined;
let countersTimer: ReturnType<typeof setInterval> | undefined;
let incidentsTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  loadDriverMap();
  loadCounters();
  loadIncidents();
  driverMapTimer = setInterval(loadDriverMap, DRIVER_MAP_POLL_MS);
  countersTimer = setInterval(loadCounters, COUNTERS_POLL_MS);
  incidentsTimer = setInterval(loadIncidents, INCIDENTS_POLL_MS);
});

onUnmounted(() => {
  clearInterval(driverMapTimer);
  clearInterval(countersTimer);
  clearInterval(incidentsTimer);
});
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-slate-900">Live operations</h1>
      <div class="flex items-center gap-2">
        <label class="text-sm text-slate-500" for="region">Region</label>
        <input
          id="region"
          v-model="region"
          type="text"
          class="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          @change="onRegionChange"
        >
      </div>
    </div>

    <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-2">
      <div class="rounded-lg border border-slate-200 bg-white p-4">
        <div class="text-2xl font-semibold text-slate-900">
          {{ counters?.online_drivers_live ?? '—' }}
        </div>
        <div class="mt-1 text-sm text-slate-500">Online drivers (live)</div>
      </div>
      <div class="rounded-lg border border-slate-200 bg-white p-4">
        <div class="text-2xl font-semibold text-slate-900">
          {{ counters?.available_drivers_live ?? '—' }}
        </div>
        <div class="mt-1 text-sm text-slate-500">Available drivers (live)</div>
      </div>
    </div>
    <p v-if="countersError" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ countersError }}
    </p>

    <h2 class="mb-3 text-base font-semibold text-slate-900">Driver map — {{ region }}</h2>
    <p v-if="driverMapError" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ driverMapError }}
    </p>
    <DriverMap v-else :drivers="driverMap?.drivers ?? []" />
    <p v-if="driverMap?.truncated" class="mt-2 text-xs text-amber-700">
      Showing the first 500 drivers in this region — the list was truncated.
    </p>

    <h2 class="mb-3 mt-8 text-base font-semibold text-slate-900">Incidents</h2>
    <p v-if="incidentsError" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ incidentsError }}
    </p>

    <table v-else-if="incidents.length > 0" class="w-full text-left text-sm">
      <thead>
        <tr class="border-b border-slate-200 text-slate-500">
          <th class="py-2 font-medium">Type</th>
          <th class="py-2 font-medium">Region</th>
          <th class="py-2 font-medium">Details</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="incident in incidents"
          :key="incident.type === 'stale_searching_ride' ? incident.ride_request_id : incident.trip_id"
          class="border-b border-slate-100"
        >
          <td class="py-2">
            <span
              class="rounded px-1.5 py-0.5 text-xs"
              :class="incident.type === 'stale_searching_ride' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'"
            >
              {{ incident.type === 'stale_searching_ride' ? 'Stuck matching' : 'Silent driver' }}
            </span>
          </td>
          <td class="py-2">{{ incident.region_id ?? '—' }}</td>
          <td class="py-2">
            <template v-if="incident.type === 'stale_searching_ride'">
              Ride {{ incident.ride_request_id.slice(0, 8) }} — searching for
              {{ Math.round(incident.waiting_ms / 60000) }} min
            </template>
            <template v-else>
              Driver {{ incident.driver_id.slice(0, 8) }} on trip
              {{ incident.trip_id.slice(0, 8) }}, no recent location
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="text-sm text-slate-500">No incidents right now.</p>
  </div>
</template>
