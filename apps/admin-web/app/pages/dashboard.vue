<script setup lang="ts">
import type { DashboardSummary, RegionMetrics } from '~/types/dashboard';

const api = useAdminApi();

const {
  data: summary,
  pending: summaryPending,
  error: summaryError,
} = useAsyncData('dashboard-summary', () =>
  api.get<DashboardSummary>('/api/v1/admin/dashboard/summary'),
);

const {
  data: regions,
  pending: regionsPending,
  error: regionsError,
} = useAsyncData('dashboard-regions', () =>
  api.get<RegionMetrics[]>('/api/v1/admin/dashboard/regions'),
);

const cards = computed(() => {
  const s = summary.value;
  if (!s) return [];
  return [
    { label: 'Online drivers', value: s.online_drivers },
    { label: 'Available drivers', value: s.available_drivers },
    { label: 'Active trips', value: s.active_trips },
    { label: 'Searching rides', value: s.searching_rides },
    { label: 'Rides today', value: s.rides_today },
    { label: 'Completed trips today', value: s.completed_trips_today },
    { label: 'Cancelled trips today', value: s.cancelled_trips_today },
    { label: 'Failed payments today', value: s.failed_payments_today },
    {
      label: 'Avg. matching time',
      value: s.average_matching_time_ms !== null ? `${Math.round(s.average_matching_time_ms)}ms` : '—',
    },
  ];
});
</script>

<template>
  <div>
    <h1 class="mb-6 text-lg font-semibold text-slate-900">Dashboard</h1>

    <p v-if="summaryError" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ summaryError.message }}
    </p>

    <div v-if="summaryPending" class="text-sm text-slate-500">Loading…</div>

    <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <div
        v-for="card in cards"
        :key="card.label"
        class="rounded-lg border border-slate-200 bg-white p-4"
      >
        <div class="text-2xl font-semibold text-slate-900">{{ card.value }}</div>
        <div class="mt-1 text-sm text-slate-500">{{ card.label }}</div>
      </div>
    </div>

    <h2 class="mb-3 mt-8 text-base font-semibold text-slate-900">By region</h2>

    <p v-if="regionsError" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ regionsError.message }}
    </p>

    <div v-if="regionsPending" class="text-sm text-slate-500">Loading…</div>

    <table v-else-if="regions && regions.length > 0" class="w-full text-left text-sm">
      <thead>
        <tr class="border-b border-slate-200 text-slate-500">
          <th class="py-2 font-medium">Region</th>
          <th class="py-2 font-medium">Online</th>
          <th class="py-2 font-medium">Available</th>
          <th class="py-2 font-medium">Active trips</th>
          <th class="py-2 font-medium">Searching</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="region in regions" :key="region.region_id" class="border-b border-slate-100">
          <td class="py-2 text-slate-900">{{ region.region_id }}</td>
          <td class="py-2">{{ region.online_drivers }}</td>
          <td class="py-2">{{ region.available_drivers }}</td>
          <td class="py-2">{{ region.active_trips }}</td>
          <td class="py-2">{{ region.searching_rides }}</td>
        </tr>
      </tbody>
    </table>

    <p v-else class="text-sm text-slate-500">No regional data yet.</p>
  </div>
</template>
