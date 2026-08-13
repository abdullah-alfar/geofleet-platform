<script setup lang="ts">
import type { Customer } from '~/types/customer';

const route = useRoute();
const customerId = route.params.id as string;

const api = useAdminApi();

const {
  data: customer,
  pending,
  error,
} = useAsyncData(`customer-${customerId}`, () => api.get<Customer>(`/api/v1/admin/customers/${customerId}`));
</script>

<template>
  <div>
    <NuxtLink to="/customers" class="mb-4 inline-block text-sm text-slate-500 hover:text-slate-900">
      ← Customers
    </NuxtLink>

    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error.message }}
    </p>
    <p v-if="pending" class="text-sm text-slate-500">Loading…</p>

    <div v-else-if="customer">
      <h1 class="mb-4 text-lg font-semibold text-slate-900">
        {{ customer.name ?? customer.customer_id }}
      </h1>

      <dl class="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-slate-200 bg-white p-6 text-sm">
        <div>
          <dt class="text-slate-500">Customer ID</dt>
          <dd class="text-slate-900">{{ customer.customer_id }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Status</dt>
          <dd class="text-slate-900">{{ customer.status ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Email</dt>
          <dd class="text-slate-900">{{ customer.email ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Phone</dt>
          <dd class="text-slate-900">{{ customer.phone_masked ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Region</dt>
          <dd class="text-slate-900">{{ customer.region_id ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Rating</dt>
          <dd class="text-slate-900">{{ customer.rating ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Total rides</dt>
          <dd class="text-slate-900">{{ customer.total_rides ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Total trips</dt>
          <dd class="text-slate-900">{{ customer.total_trips ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-slate-500">Joined</dt>
          <dd class="text-slate-900">
            {{ customer.created_at ? new Date(customer.created_at).toLocaleString() : '—' }}
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>
