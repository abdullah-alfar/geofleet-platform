<script setup lang="ts">
import type { RideDetail, RideOffer } from '~/types/ride';

const route = useRoute();
const rideId = route.params.id as string;
const api = useAdminApi();

const { data: ride, pending, error } = useAsyncData(`ride-${rideId}`, () =>
  api.get<RideDetail>(`/api/v1/admin/rides/${rideId}`),
);

const {
  data: offers,
  pending: offersPending,
  error: offersError,
} = useAsyncData(`ride-${rideId}-offers`, () =>
  api.get<RideOffer[]>(`/api/v1/admin/rides/${rideId}/offers`),
);
</script>

<template>
  <div>
    <NuxtLink to="/rides" class="mb-4 inline-block text-sm text-slate-500 hover:text-slate-900">
      ← Rides
    </NuxtLink>

    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error.message }}
    </p>
    <p v-if="pending" class="text-sm text-slate-500">Loading…</p>

    <div v-else-if="ride">
      <h1 class="mb-4 text-lg font-semibold text-slate-900">Ride {{ ride.ride_request_id.slice(0, 8) }}</h1>

      <dl class="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-slate-200 bg-white p-6 text-sm">
        <div>
          <dt class="text-slate-500">Status</dt>
          <dd class="text-slate-900">{{ ride.status }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Region</dt>
          <dd class="text-slate-900">{{ ride.region_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Customer</dt>
          <dd class="text-slate-900">{{ ride.customer_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Driver</dt>
          <dd class="text-slate-900">{{ ride.driver_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Pickup</dt>
          <dd class="text-slate-900">
            {{ ride.pickup_latitude ?? '—' }}, {{ ride.pickup_longitude ?? '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-slate-500">Dropoff</dt>
          <dd class="text-slate-900">
            {{ ride.dropoff_latitude ?? '—' }}, {{ ride.dropoff_longitude ?? '—' }}
          </dd>
        </div>
      </dl>

      <h2 class="mb-3 text-base font-semibold text-slate-900">Timeline</h2>
      <ul class="mb-6 space-y-2 text-sm">
        <li v-for="milestone in ride.timeline" :key="milestone.event" class="flex gap-3">
          <span class="w-32 shrink-0 font-medium text-slate-700">{{ milestone.event }}</span>
          <span class="text-slate-500">{{ new Date(milestone.at).toLocaleString() }}</span>
        </li>
        <li v-if="ride.timeline.length === 0" class="text-slate-500">No milestones recorded yet.</li>
      </ul>

      <h2 class="mb-3 text-base font-semibold text-slate-900">Offers</h2>

      <p v-if="offersError" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ offersError.message }}
      </p>
      <p v-if="offersPending" class="text-sm text-slate-500">Loading…</p>

      <table v-else-if="offers && offers.length > 0" class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-slate-200 text-slate-500">
            <th class="py-2 font-medium">Driver</th>
            <th class="py-2 font-medium">Status</th>
            <th class="py-2 font-medium">Created</th>
            <th class="py-2 font-medium">Expires</th>
            <th class="py-2 font-medium">Responded</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="offer in offers" :key="offer.offer_id" class="border-b border-slate-100">
            <td class="py-2">{{ offer.driver_id.slice(0, 8) }}</td>
            <td class="py-2">
              {{ offer.status }}
              <span v-if="offer.is_expired" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">expired</span>
            </td>
            <td class="py-2">{{ offer.created_at ? new Date(offer.created_at).toLocaleTimeString() : '—' }}</td>
            <td class="py-2">{{ offer.expires_at ? new Date(offer.expires_at).toLocaleTimeString() : '—' }}</td>
            <td class="py-2">{{ offer.responded_at ? new Date(offer.responded_at).toLocaleTimeString() : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="text-sm text-slate-500">No offers made for this ride yet.</p>
    </div>
  </div>
</template>
