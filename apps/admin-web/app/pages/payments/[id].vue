<script setup lang="ts">
import type { Payment } from '~/types/payment';

const route = useRoute();
const paymentId = route.params.id as string;

const api = useAdminApi();
const auth = useAuthStore();

const {
  data: payment,
  pending,
  error,
  refresh,
} = useAsyncData(`payment-${paymentId}`, () =>
  api.get<Payment>(`/api/v1/admin/payments/${paymentId}`),
);

const command = useAdminCommand();
const successMessage = ref<string | null>(null);

/** core-api's own PaymentResource shape (Phase 6), not admin-api's
 * projection shape — see the equivalent note on drivers/[id].vue. */
interface PaymentCommandResult {
  id: string;
  status: string;
}

async function onRefund(reason: string) {
  successMessage.value = null;
  const result = await command.run<PaymentCommandResult>(
    `/api/v1/admin/payments/${paymentId}/refund`,
    reason || undefined,
  );
  if (result) {
    successMessage.value = `Payment refunded (core-api status: ${result.status}). No Kafka event fires for a refund — see docs/admin-api/laravel-integration.md — so this list won't reflect it until you refresh, not because of replication lag.`;
    await refresh();
  }
}
</script>

<template>
  <div>
    <NuxtLink to="/payments" class="mb-4 inline-block text-sm text-slate-500 hover:text-slate-900">
      ← Payments
    </NuxtLink>

    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error.message }}
    </p>
    <p v-if="pending" class="text-sm text-slate-500">Loading…</p>

    <div v-else-if="payment">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-lg font-semibold text-slate-900">Payment {{ payment.payment_id.slice(0, 8) }}</h1>

        <CommandButton
          v-if="auth.hasAbility('payments.refund') && payment.status === 'completed'"
          label="Refund payment"
          variant="danger"
          :pending="command.pending.value"
          @confirm="onRefund"
        />
      </div>

      <p v-if="command.error.value" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ command.error.value.message }}
      </p>
      <p v-if="successMessage" class="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
        {{ successMessage }}
      </p>

      <dl class="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-slate-200 bg-white p-6 text-sm">
        <div>
          <dt class="text-slate-500">Status</dt>
          <dd class="text-slate-900">{{ payment.status }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Amount</dt>
          <dd class="text-slate-900">{{ payment.amount ?? '—' }} {{ payment.currency ?? '' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Provider</dt>
          <dd class="text-slate-900">{{ payment.provider ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Region</dt>
          <dd class="text-slate-900">{{ payment.region_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Trip</dt>
          <dd class="text-slate-900">{{ payment.trip_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Customer</dt>
          <dd class="text-slate-900">{{ payment.customer_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Created</dt>
          <dd class="text-slate-900">
            {{ payment.created_at ? new Date(payment.created_at).toLocaleString() : '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-slate-500">Paid at</dt>
          <dd class="text-slate-900">
            {{ payment.paid_at ? new Date(payment.paid_at).toLocaleString() : '—' }}
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>
