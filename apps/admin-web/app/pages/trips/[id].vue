<script setup lang="ts">
import type { TripDetail } from '~/types/trip';

const route = useRoute();
const tripId = route.params.id as string;

const api = useAdminApi();
const auth = useAuthStore();

const {
  data: trip,
  pending,
  error,
  refresh,
} = useAsyncData(`trip-${tripId}`, () => api.get<TripDetail>(`/api/v1/admin/trips/${tripId}`));

const command = useAdminCommand();
const successMessage = ref<string | null>(null);

/** core-api's own TripResource shape (Phase 6), not admin-api's
 * projection shape — see the equivalent note on drivers/[id].vue. */
interface TripCommandResult {
  id: string;
  status: string;
}

async function onCancel(reason: string) {
  successMessage.value = null;
  const result = await command.run<TripCommandResult>(
    `/api/v1/admin/trips/${tripId}/cancel`,
    reason || undefined,
  );
  if (result) {
    successMessage.value = `Trip cancelled (status: ${result.status}).`;
    await refresh();
  }
}
</script>

<template>
  <div>
    <NuxtLink to="/trips" class="mb-4 inline-block text-sm text-slate-500 hover:text-slate-900">
      ← Trips
    </NuxtLink>

    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error.message }}
    </p>
    <p v-if="pending" class="text-sm text-slate-500">Loading…</p>

    <div v-else-if="trip">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-lg font-semibold text-slate-900">Trip {{ trip.trip_id.slice(0, 8) }}</h1>

        <CommandButton
          v-if="auth.hasAbility('trips.cancel') && trip.status === 'in_progress'"
          label="Cancel trip"
          variant="danger"
          :pending="command.pending.value"
          @confirm="onCancel"
        />
      </div>

      <p v-if="command.error.value" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ command.error.value.message }}
      </p>
      <p v-if="successMessage" class="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
        {{ successMessage }}
      </p>

      <dl class="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-slate-200 bg-white p-6 text-sm">
        <div>
          <dt class="text-slate-500">Status</dt>
          <dd class="text-slate-900">{{ trip.status }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Region</dt>
          <dd class="text-slate-900">{{ trip.region_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Driver</dt>
          <dd class="text-slate-900">{{ trip.driver_id }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Customer</dt>
          <dd class="text-slate-900">{{ trip.customer_id }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Fare</dt>
          <dd class="text-slate-900">{{ trip.fare_amount ?? '—' }} {{ trip.currency ?? '' }}</dd>
        </div>
      </dl>

      <h2 class="mb-3 text-base font-semibold text-slate-900">Timeline</h2>
      <ul class="space-y-2 text-sm">
        <li v-for="milestone in trip.timeline" :key="milestone.event" class="flex gap-3">
          <span class="w-32 shrink-0 font-medium text-slate-700">{{ milestone.event }}</span>
          <span class="text-slate-500">{{ new Date(milestone.at).toLocaleString() }}</span>
        </li>
        <li v-if="trip.timeline.length === 0" class="text-slate-500">No milestones recorded yet.</li>
      </ul>
    </div>
  </div>
</template>
