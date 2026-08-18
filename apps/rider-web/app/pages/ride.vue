<script setup lang="ts">
import type { RideRequest, CustomerSocketMessage } from '~/types/ride';

const RIDE_STORAGE_KEY = 'rider-web:ride_request_id';
const POLL_MS = 3000;
const TERMINAL_STATUSES = ['cancelled', 'expired', 'unavailable'];

const api = useCoreApi();

const ride = ref<RideRequest | null>(null);
const driverLat = ref<number | null>(null);
const driverLng = ref<number | null>(null);
const driverLastSeenAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const isSubmitting = ref(false);
const isCancelling = ref(false);

// Form defaults match this repo's own test data (scripts/api-test/09-create-ride-request.sh)
// — a real pickup/dropoff pair in Amman a seeded driver can actually reach.
const pickupLat = ref(31.9539);
const pickupLng = ref(35.9106);
const pickupAddress = ref('Rainbow St, Amman');
const dropoffLat = ref(31.97);
const dropoffLng = ref(35.95);
const dropoffAddress = ref('Abdali, Amman');
const vehicleType = ref<'sedan' | 'suv' | 'van' | 'motorcycle'>('sedan');

let pollTimer: ReturnType<typeof setInterval> | undefined;

const phase = computed<'form' | 'searching' | 'assigned' | 'ended'>(() => {
  if (!ride.value) return 'form';
  if (ride.value.status === 'accepted') return 'assigned';
  if (TERMINAL_STATUSES.includes(ride.value.status)) return 'ended';
  return 'searching';
});

async function loadRide(id: string) {
  try {
    ride.value = await api.get<RideRequest>(`/api/v1/ride-requests/${id}`);
  } catch {
    // Gone/inaccessible (e.g. stale id from a previous session) — drop it
    // and fall back to the request form rather than getting stuck.
    clearRide();
  }
}

function startPolling(id: string) {
  stopPolling();
  pollTimer = setInterval(() => loadRide(id), POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = undefined;
}

function saveRideId(id: string) {
  if (import.meta.client) localStorage.setItem(RIDE_STORAGE_KEY, id);
}

function clearRide() {
  ride.value = null;
  driverLat.value = null;
  driverLng.value = null;
  driverLastSeenAt.value = null;
  stopPolling();
  if (import.meta.client) localStorage.removeItem(RIDE_STORAGE_KEY);
}

async function requestRide() {
  errorMessage.value = null;
  isSubmitting.value = true;
  try {
    const created = await api.post<RideRequest>(
      '/api/v1/ride-requests',
      {
        pickup_lat: pickupLat.value,
        pickup_lng: pickupLng.value,
        pickup_address: pickupAddress.value || undefined,
        dropoff_lat: dropoffLat.value,
        dropoff_lng: dropoffLng.value,
        dropoff_address: dropoffAddress.value || undefined,
        requested_vehicle_type: vehicleType.value,
      },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
    ride.value = created;
    saveRideId(created.id);
    startPolling(created.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not request a ride.';
  } finally {
    isSubmitting.value = false;
  }
}

async function cancelRide() {
  if (!ride.value) return;
  isCancelling.value = true;
  try {
    ride.value = await api.post<RideRequest>(`/api/v1/ride-requests/${ride.value.id}/cancel`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not cancel the ride.';
  } finally {
    isCancelling.value = false;
  }
}

function requestAnother() {
  clearRide();
}

function onSocketMessage(msg: CustomerSocketMessage) {
  if (msg.type === 'ride.assigned' && msg.data.ride_request_id === ride.value?.id) {
    // The push arrives before REST would notice — refetch immediately so
    // the driver card renders without waiting for the next poll tick.
    loadRide(msg.data.ride_request_id);
  } else if (msg.type === 'ride.unavailable' && msg.data.ride_request_id === ride.value?.id) {
    loadRide(msg.data.ride_request_id);
  } else if (msg.type === 'driver.location' && msg.data.ride_request_id === ride.value?.id) {
    driverLat.value = msg.data.lat;
    driverLng.value = msg.data.lng;
    driverLastSeenAt.value = msg.data.recorded_at;
  }
}

const socket = useCustomerSocket(onSocketMessage);

onMounted(async () => {
  socket.connect();

  if (import.meta.client) {
    const savedId = localStorage.getItem(RIDE_STORAGE_KEY);
    if (savedId) {
      await loadRide(savedId);
      if (ride.value && !TERMINAL_STATUSES.includes(ride.value.status)) {
        startPolling(savedId);
      }
    }
  }
});

onUnmounted(() => {
  socket.disconnect();
  stopPolling();
});
</script>

<template>
  <div>
    <h1 class="mb-6 text-lg font-semibold text-slate-900">
      <template v-if="phase === 'form'">Request a ride</template>
      <template v-else-if="phase === 'searching'">Finding you a driver…</template>
      <template v-else-if="phase === 'assigned'">Your driver is on the way</template>
      <template v-else>Ride ended</template>
    </h1>

    <p v-if="errorMessage" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ errorMessage }}
    </p>

    <!-- Request form -->
    <form v-if="phase === 'form'" class="space-y-4 rounded-lg border border-slate-200 bg-white p-6" @submit.prevent="requestRide">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Pickup address</label>
          <input v-model="pickupAddress" type="text" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Dropoff address</label>
          <input v-model="dropoffAddress" type="text" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Pickup lat/lng</label>
          <div class="flex gap-2">
            <input v-model.number="pickupLat" type="number" step="0.0001" class="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm">
            <input v-model.number="pickupLng" type="number" step="0.0001" class="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm">
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-slate-700">Dropoff lat/lng</label>
          <div class="flex gap-2">
            <input v-model.number="dropoffLat" type="number" step="0.0001" class="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm">
            <input v-model.number="dropoffLng" type="number" step="0.0001" class="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm">
          </div>
        </div>
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium text-slate-700">Vehicle type</label>
        <select v-model="vehicleType" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="sedan">Sedan</option>
          <option value="suv">SUV</option>
          <option value="van">Van</option>
          <option value="motorcycle">Motorcycle</option>
        </select>
      </div>

      <button
        type="submit"
        :disabled="isSubmitting"
        class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {{ isSubmitting ? 'Requesting…' : 'Request ride' }}
      </button>
    </form>

    <!-- Searching -->
    <div v-else-if="phase === 'searching'" class="rounded-lg border border-slate-200 bg-white p-6">
      <p class="text-sm text-slate-600">
        Looking for a nearby driver for your {{ ride?.requested_vehicle_type }} ride
        ({{ ride?.pickup_address ?? 'pickup' }} → {{ ride?.dropoff_address ?? 'dropoff' }})…
      </p>
      <p class="mt-2 text-xs text-slate-400">Status: {{ ride?.status }}</p>
      <button
        type="button"
        :disabled="isCancelling"
        class="mt-4 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        @click="cancelRide"
      >
        {{ isCancelling ? 'Cancelling…' : 'Cancel ride' }}
      </button>
    </div>

    <!-- Assigned: live tracking -->
    <div v-else-if="phase === 'assigned'" class="space-y-4">
      <div class="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <p class="font-medium text-slate-900">
          Driver rating: {{ ride?.driver?.rating ?? 'new driver' }}
          <span v-if="ride?.driver?.active_vehicle?.vehicle_type"> · {{ ride.driver.active_vehicle.vehicle_type }}</span>
        </p>
        <p class="mt-1 text-slate-500">
          <template v-if="driverLat !== null">
            Live — updated {{ driverLastSeenAt ? new Date(driverLastSeenAt).toLocaleTimeString() : '' }}
          </template>
          <template v-else> Waiting for your driver's first location update… </template>
        </p>
      </div>

      <RideTrackingMap :latitude="driverLat" :longitude="driverLng" />
    </div>

    <!-- Ended -->
    <div v-else class="rounded-lg border border-slate-200 bg-white p-6">
      <p class="text-sm text-slate-600">
        This ride is <span class="font-medium">{{ ride?.status }}</span>.
      </p>
      <button
        type="button"
        class="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        @click="requestAnother"
      >
        Request another ride
      </button>
    </div>
  </div>
</template>
