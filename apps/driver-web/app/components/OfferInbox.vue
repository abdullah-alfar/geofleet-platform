<script setup lang="ts">
import type { RideOffer, DriverSocketMessage } from '~/types/offer';

/** Fallback poll interval — the WebSocket push (useDriverSocket) is what
 * actually drives this in real time; this just catches an offer created
 * while the socket happened to be reconnecting. Only polls while no
 * offer is currently shown, so it can't clobber one already on screen. */
const POLL_MS = 5000;

const emit = defineEmits<{ assigned: [rideRequestId: string] }>();

const { call } = useDeviceApi();
const config = useRuntimeConfig();

const currentOffer = ref<RideOffer | null>(null);
const error = ref<string | null>(null);
const isResponding = ref(false);
const now = ref(Date.now());

const secondsLeft = computed(() => {
  if (!currentOffer.value) return 0;
  return Math.max(0, Math.round((new Date(currentOffer.value.expires_at).getTime() - now.value) / 1000));
});

let pollTimer: ReturnType<typeof setInterval> | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;

async function pollPending() {
  if (currentOffer.value) return;
  try {
    const response = await call<{ data: RideOffer[] }>(
      config.public.dispatchServiceBaseUrl,
      'GET',
      '/v1/ride-offers/pending',
    );
    if (response.data.length > 0) {
      currentOffer.value = response.data[0]!;
    }
  } catch {
    // Best-effort fallback — the socket is the primary channel, stay
    // quiet here rather than surface a poll failure as a hard error.
  }
}

function onSocketMessage(msg: DriverSocketMessage) {
  if (msg.type === 'ride.offer.created') {
    currentOffer.value = {
      offer_id: msg.data.offer_id,
      ride_request_id: msg.data.ride_request_id,
      offered_at: new Date().toISOString(),
      expires_at: msg.data.expires_at,
    };
  }
}

const socket = useDriverSocket(onSocketMessage);

async function accept() {
  if (!currentOffer.value) return;
  error.value = null;
  isResponding.value = true;
  try {
    const offerId = currentOffer.value.offer_id;
    const result = await call<{ status: string; ride_request_id: string }>(
      config.public.dispatchServiceBaseUrl,
      'POST',
      `/v1/ride-offers/${offerId}/accept`,
    );
    currentOffer.value = null;
    emit('assigned', result.ride_request_id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not accept the offer (it may have expired).';
    currentOffer.value = null;
  } finally {
    isResponding.value = false;
  }
}

async function reject() {
  if (!currentOffer.value) return;
  error.value = null;
  isResponding.value = true;
  try {
    await call(config.public.dispatchServiceBaseUrl, 'POST', `/v1/ride-offers/${currentOffer.value.offer_id}/reject`);
  } catch {
    // Already gone/expired server-side — treat as resolved either way.
  } finally {
    currentOffer.value = null;
    isResponding.value = false;
  }
}

onMounted(() => {
  socket.connect();
  pollPending();
  pollTimer = setInterval(pollPending, POLL_MS);
  clockTimer = setInterval(() => {
    now.value = Date.now();
    if (currentOffer.value && secondsLeft.value === 0) {
      currentOffer.value = null; // client-side hint only; accept still fails safely server-side if this is wrong
    }
  }, 1000);
});

onUnmounted(() => {
  socket.disconnect();
  clearInterval(pollTimer);
  clearInterval(clockTimer);
});
</script>

<template>
  <div>
    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</p>

    <div v-if="currentOffer" class="rounded-lg border border-slate-200 bg-white p-6">
      <p class="text-base font-medium text-slate-900">New ride offer</p>
      <p class="mt-1 text-sm text-slate-500">Ride {{ currentOffer.ride_request_id.slice(0, 8) }} — expires in {{ secondsLeft }}s</p>
      <div class="mt-4 flex gap-2">
        <button
          type="button"
          :disabled="isResponding"
          class="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          @click="accept"
        >
          Accept
        </button>
        <button
          type="button"
          :disabled="isResponding"
          class="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          @click="reject"
        >
          Reject
        </button>
      </div>
    </div>
    <p v-else class="text-sm text-slate-500">Waiting for a ride offer…</p>
  </div>
</template>
