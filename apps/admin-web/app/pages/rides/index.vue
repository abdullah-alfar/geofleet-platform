<script setup lang="ts">
import type { Ride } from '~/types/ride';

const { query, items, nextCursor, pending, error, refresh, loadMore } = usePaginatedList<Ride>(
  '/api/v1/admin/rides',
  { limit: 20 },
);

refresh();
</script>

<template>
  <div>
    <h1 class="mb-6 text-lg font-semibold text-slate-900">Rides</h1>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent="refresh">
      <div>
        <label class="mb-1 block text-xs text-slate-500">Status</label>
        <input v-model="query.status" type="text" placeholder="searching" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <div>
        <label class="mb-1 block text-xs text-slate-500">Region</label>
        <input v-model="query.region_id" type="text" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <div>
        <label class="mb-1 block text-xs text-slate-500">Driver ID</label>
        <input v-model="query.driver_id" type="text" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <div>
        <label class="mb-1 block text-xs text-slate-500">Customer ID</label>
        <input v-model="query.customer_id" type="text" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
        Filter
      </button>
    </form>

    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error.message }}
    </p>

    <table class="w-full text-left text-sm">
      <thead>
        <tr class="border-b border-slate-200 text-slate-500">
          <th class="py-2 font-medium">Ride</th>
          <th class="py-2 font-medium">Status</th>
          <th class="py-2 font-medium">Region</th>
          <th class="py-2 font-medium">Driver</th>
          <th class="py-2 font-medium">Requested</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="ride in items" :key="ride.ride_request_id" class="border-b border-slate-100 hover:bg-slate-50">
          <td class="py-2">
            <NuxtLink :to="`/rides/${ride.ride_request_id}`" class="text-slate-900 hover:underline">
              {{ ride.ride_request_id.slice(0, 8) }}
            </NuxtLink>
          </td>
          <td class="py-2">{{ ride.status }}</td>
          <td class="py-2">{{ ride.region_id ?? '—' }}</td>
          <td class="py-2">{{ ride.driver_id ? ride.driver_id.slice(0, 8) : '—' }}</td>
          <td class="py-2">{{ ride.requested_at ? new Date(ride.requested_at).toLocaleString() : '—' }}</td>
        </tr>
      </tbody>
    </table>

    <p v-if="!pending && items.length === 0" class="py-6 text-sm text-slate-500">No rides match these filters.</p>
    <p v-if="pending" class="py-6 text-sm text-slate-500">Loading…</p>

    <button
      v-if="nextCursor && !pending"
      type="button"
      class="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
      @click="loadMore"
    >
      Load more
    </button>
  </div>
</template>
