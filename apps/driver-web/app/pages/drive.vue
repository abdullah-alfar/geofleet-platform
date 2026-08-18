<script setup lang="ts">
import type { Vehicle } from '~/types/user';
import type { DriverDevice } from '~/types/device';

const GPS_PING_INTERVAL_MS = 5000;

const auth = useAuthStore();
const device = useDeviceStore();
const coreApi = useCoreApi();
const { sendPing } = useGpsPing();

const driver = computed(() => auth.user?.driver ?? null);

// --- Device registration (auto, once, on first visit) --------------------
const deviceError = ref<string | null>(null);
const isRegisteringDevice = ref(false);

async function registerDeviceIfNeeded() {
  if (device.isRegistered || !import.meta.client) return;
  isRegisteringDevice.value = true;
  deviceError.value = null;
  try {
    const platform = /android/i.test(navigator.userAgent) ? 'android' : 'ios';
    const response = await coreApi.postWithMeta<DriverDevice, { device_token: string }>(
      '/api/v1/driver/devices',
      {
        device_identifier: stableDeviceIdentifier(),
        platform,
        app_version: 'driver-web-1.0',
      },
    );
    device.set(response.data.id, response.meta.device_token);
  } catch (e) {
    deviceError.value = e instanceof Error ? e.message : 'Could not register this device.';
  } finally {
    isRegisteringDevice.value = false;
  }
}

// --- Vehicle setup ---------------------------------------------------------
const vehicleError = ref<string | null>(null);
const isSavingVehicle = ref(false);
const make = ref('');
const model = ref('');
const year = ref(new Date().getFullYear());
const color = ref('');
const plateNumber = ref('');
const vehicleType = ref<'sedan' | 'suv' | 'van' | 'motorcycle'>('sedan');

async function saveVehicle() {
  vehicleError.value = null;
  isSavingVehicle.value = true;
  try {
    await coreApi.post<Vehicle>('/api/v1/drivers/vehicles', {
      make: make.value,
      model: model.value,
      year: year.value,
      color: color.value,
      plate_number: plateNumber.value,
      vehicle_type: vehicleType.value,
    });
    await auth.refresh();
  } catch (e) {
    vehicleError.value = e instanceof Error ? e.message : 'Could not save this vehicle.';
  } finally {
    isSavingVehicle.value = false;
  }
}

// --- Availability toggle + GPS ping loop -----------------------------------
const availabilityError = ref<string | null>(null);
const isTogglingAvailability = ref(false);
const gpsError = ref<string | null>(null);
const lastPingAt = ref<string | null>(null);

// Prefilled to the same Amman point apps/rider-web's ride form defaults
// to, so a demo driver and a demo rider naturally end up near each other
// — this platform's seeded drivers/customers/regions are all Amman-based
// demo data, not real geography tied to wherever this browser actually
// is. Real browser geolocation is opt-in (see useRealGps below), not the
// default: a real device is almost never physically in Amman, so
// switching from this fixed point to a real position mid-loop implies
// "traveled thousands of km in 5 seconds" — location-service correctly
// rejects that as an implausible speed (see
// internal/validation/validateMovement), and every following real-GPS
// ping keeps failing the same way against that same stale last-accepted
// point. Manual lat/lng (near-zero implied speed between pings) avoids
// the failure mode entirely and is what this demo data actually expects.
const lat = ref(31.9539);
const lng = ref(35.9106);
const useRealGps = ref(false);

let pingTimer: ReturnType<typeof setInterval> | undefined;
let geoWatchId: number | null = null;

async function pingOnce() {
  if (!driver.value) return;
  try {
    await sendPing(driver.value.id, lat.value, lng.value);
    lastPingAt.value = new Date().toISOString();
    gpsError.value = null;
  } catch (e) {
    gpsError.value = e instanceof Error ? e.message : 'GPS ping failed.';
  }
}

function startGpsLoop() {
  if (useRealGps.value && import.meta.client && 'geolocation' in navigator) {
    geoWatchId = navigator.geolocation.watchPosition(
      (position) => {
        lat.value = position.coords.latitude;
        lng.value = position.coords.longitude;
      },
      () => {
        // Permission denied or unavailable — fall back to the manual
        // lat/lng fields below, which the ping loop already uses.
      },
      { enableHighAccuracy: true },
    );
  }
  pingOnce();
  pingTimer = setInterval(pingOnce, GPS_PING_INTERVAL_MS);
}

function stopGpsLoop() {
  clearInterval(pingTimer);
  pingTimer = undefined;
  if (geoWatchId !== null && import.meta.client) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

async function toggleAvailability() {
  if (!driver.value) return;
  availabilityError.value = null;
  isTogglingAvailability.value = true;
  const goingOnline = !driver.value.is_available;
  try {
    await coreApi.patch('/api/v1/driver/availability', { is_available: goingOnline });
    await auth.refresh();
    if (goingOnline) {
      startGpsLoop();
    } else {
      stopGpsLoop();
    }
  } catch (e) {
    availabilityError.value = e instanceof Error ? e.message : 'Could not update availability.';
  } finally {
    isTogglingAvailability.value = false;
  }
}

// --- Offer -> assigned ------------------------------------------------------
const assignedRideId = ref<string | null>(null);
function onAssigned(rideRequestId: string) {
  assignedRideId.value = rideRequestId;
}
function dismissAssigned() {
  assignedRideId.value = null;
}

onMounted(async () => {
  await registerDeviceIfNeeded();
  if (driver.value?.is_available) {
    startGpsLoop(); // page reload while already online — resume pinging
  }
});

onUnmounted(() => {
  stopGpsLoop();
});
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-lg font-semibold text-slate-900">Drive</h1>

    <p v-if="!driver" class="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-700">
      This account has no driver profile.
    </p>

    <template v-else>
      <div class="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <p>
          Status: <span class="font-medium">{{ driver.status }}</span>
          <span v-if="driver.status === 'pending_review'" class="text-slate-500"> — waiting for admin approval before you can go online</span>
          <span v-else-if="driver.status === 'suspended'" class="text-red-600"> — suspended, cannot go online</span>
          <span v-else-if="driver.status === 'disabled'" class="text-red-600"> — disabled</span>
        </p>
      </div>

      <p v-if="isRegisteringDevice" class="text-sm text-slate-500">Setting up this device…</p>
      <p v-if="deviceError" class="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{{ deviceError }}</p>

      <!-- Vehicle setup -->
      <div v-if="device.isRegistered && !driver.active_vehicle" class="rounded-lg border border-slate-200 bg-white p-6">
        <h2 class="mb-3 text-base font-semibold text-slate-900">Add your vehicle</h2>
        <form class="grid grid-cols-2 gap-4" @submit.prevent="saveVehicle">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Make</label>
            <input v-model="make" type="text" required class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Model</label>
            <input v-model="model" type="text" required class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Year</label>
            <input v-model.number="year" type="number" required class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Color</label>
            <input v-model="color" type="text" required class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Plate number</label>
            <input v-model="plateNumber" type="text" required class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
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
          <p v-if="vehicleError" class="col-span-2 text-sm text-red-600">{{ vehicleError }}</p>
          <button
            type="submit"
            :disabled="isSavingVehicle"
            class="col-span-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {{ isSavingVehicle ? 'Saving…' : 'Save vehicle' }}
          </button>
        </form>
      </div>

      <!-- Availability + GPS + offers -->
      <template v-else-if="device.isRegistered && driver.active_vehicle">
        <div class="rounded-lg border border-slate-200 bg-white p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-slate-500">{{ driver.active_vehicle.make }} {{ driver.active_vehicle.model }} · {{ driver.active_vehicle.plate_number }}</p>
              <p class="mt-1 text-base font-medium text-slate-900">
                {{ driver.is_available ? 'Online' : 'Offline' }}
              </p>
            </div>
            <button
              type="button"
              :disabled="isTogglingAvailability || driver.status !== 'active'"
              class="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              :class="driver.is_available ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-900 hover:bg-slate-800'"
              @click="toggleAvailability"
            >
              {{ driver.is_available ? 'Go offline' : 'Go online' }}
            </button>
          </div>
          <p v-if="availabilityError" class="mt-3 text-sm text-red-600">{{ availabilityError }}</p>
        </div>

        <div v-if="driver.is_available" class="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p class="mb-2 font-medium text-slate-900">GPS</p>
          <div class="flex gap-2">
            <input v-model.number="lat" type="number" step="0.0001" :disabled="useRealGps" class="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400">
            <input v-model.number="lng" type="number" step="0.0001" :disabled="useRealGps" class="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400">
          </div>
          <label class="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input v-model="useRealGps" type="checkbox">
            Use my browser's real location instead
          </label>
          <p class="mt-2 text-xs text-slate-500">
            This platform's demo drivers/riders are all in Amman — leave real location off unless
            you're actually there, or every ride will imply an impossible jump in position.
            Pinged every {{ GPS_PING_INTERVAL_MS / 1000 }}s.
            <template v-if="lastPingAt">Last sent {{ new Date(lastPingAt).toLocaleTimeString() }}.</template>
          </p>
          <p v-if="gpsError" class="mt-1 text-red-600">{{ gpsError }}</p>
        </div>

        <div v-if="assignedRideId" class="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p>Assigned to ride {{ assignedRideId.slice(0, 8) }}.</p>
          <button type="button" class="mt-2 text-xs underline" @click="dismissAssigned">Dismiss</button>
        </div>

        <OfferInbox v-if="driver.is_available" @assigned="onAssigned" />
      </template>
    </template>
  </div>
</template>
