<script setup lang="ts">
import type { Driver } from '~/types/driver';

const route = useRoute();
const driverId = route.params.id as string;

const api = useAdminApi();
const auth = useAuthStore();

const {
  data: driver,
  pending,
  error,
  refresh,
} = useAsyncData(`driver-${driverId}`, () => api.get<Driver>(`/api/v1/admin/drivers/${driverId}`));

const command = useAdminCommand();
const successMessage = ref<string | null>(null);

/** core-api's own DriverResource shape (Phase 6) — different field names
 * than the Driver type above (`id` not `driver_id`, `is_available` not
 * `availability_status`). Used only to confirm the command actually
 * landed; the page re-fetches its own detail view afterward, which now
 * reads live from core-api too, so there's no lag between the two. */
interface DriverCommandResult {
  id: string;
  status: string;
}

const ACTION_LABELS: Record<string, string> = {
  approve: 'approved',
  suspend: 'suspended',
  unsuspend: 'unsuspended',
  disable: 'disabled',
};

async function runDriverCommand(action: 'approve' | 'suspend' | 'unsuspend' | 'disable', reason: string) {
  successMessage.value = null;
  const result = await command.run<DriverCommandResult>(
    `/api/v1/admin/drivers/${driverId}/${action}`,
    reason || undefined,
  );
  if (result) {
    successMessage.value = `Driver ${ACTION_LABELS[action]} (status: ${result.status}).`;
    await refresh();
  }
}
</script>

<template>
  <div>
    <NuxtLink to="/drivers" class="mb-4 inline-block text-sm text-slate-500 hover:text-slate-900">
      ← Drivers
    </NuxtLink>

    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error.message }}
    </p>
    <p v-if="pending" class="text-sm text-slate-500">Loading…</p>

    <div v-else-if="driver">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-lg font-semibold text-slate-900">
          {{ driver.name ?? driver.driver_id }}
        </h1>

        <div class="flex gap-2">
          <CommandButton
            v-if="auth.hasAbility('drivers.approve') && driver.status === 'pending_review'"
            label="Approve driver"
            :pending="command.pending.value"
            @confirm="(reason) => runDriverCommand('approve', reason)"
          />
          <CommandButton
            v-if="auth.hasAbility('drivers.unsuspend') && driver.status === 'suspended'"
            label="Unsuspend driver"
            :pending="command.pending.value"
            @confirm="(reason) => runDriverCommand('unsuspend', reason)"
          />
          <CommandButton
            v-if="auth.hasAbility('drivers.suspend') && driver.status !== 'suspended' && driver.status !== 'disabled'"
            label="Suspend driver"
            variant="danger"
            :pending="command.pending.value"
            @confirm="(reason) => runDriverCommand('suspend', reason)"
          />
          <CommandButton
            v-if="auth.hasAbility('drivers.disable') && driver.status !== 'disabled'"
            label="Disable driver"
            variant="danger"
            :pending="command.pending.value"
            @confirm="(reason) => runDriverCommand('disable', reason)"
          />
        </div>
      </div>

      <p v-if="command.error.value" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ command.error.value.message }}
      </p>
      <p v-if="successMessage" class="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
        {{ successMessage }}
      </p>

      <dl class="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-slate-200 bg-white p-6 text-sm">
        <div>
          <dt class="text-slate-500">Driver ID</dt>
          <dd class="text-slate-900">{{ driver.driver_id }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Status</dt>
          <dd class="text-slate-900">{{ driver.status ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Availability</dt>
          <dd class="text-slate-900">{{ driver.availability_status ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Vehicle type</dt>
          <dd class="text-slate-900">{{ driver.vehicle_type ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Rating</dt>
          <dd class="text-slate-900">{{ driver.rating ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Region</dt>
          <dd class="text-slate-900">{{ driver.region_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Active trip</dt>
          <dd class="text-slate-900">{{ driver.active_trip_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Last available</dt>
          <dd class="text-slate-900">
            {{ driver.last_available_at ? new Date(driver.last_available_at).toLocaleString() : '—' }}
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>
