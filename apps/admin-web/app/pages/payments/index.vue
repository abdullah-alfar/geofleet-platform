<script setup lang="ts">
import type { Payment } from '~/types/payment';

const { query, items, nextCursor, pending, error, refresh, loadMore } = usePaginatedList<Payment>(
  '/api/v1/admin/payments',
  { limit: 20 },
);

refresh();
</script>

<template>
  <div>
    <h1 class="mb-6 text-lg font-semibold text-slate-900">Payments</h1>

    <form class="mb-4 flex flex-wrap items-end gap-3" @submit.prevent="refresh">
      <div>
        <label class="mb-1 block text-xs text-slate-500">Status</label>
        <input v-model="query.status" type="text" placeholder="completed" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <div>
        <label class="mb-1 block text-xs text-slate-500">Provider</label>
        <input v-model="query.payment_provider" type="text" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <div>
        <label class="mb-1 block text-xs text-slate-500">Region</label>
        <input v-model="query.region_id" type="text" class="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <div>
        <label class="mb-1 block text-xs text-slate-500">Min amount</label>
        <input v-model.number="query.amount_from" type="number" min="0" class="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
      </div>
      <div>
        <label class="mb-1 block text-xs text-slate-500">Max amount</label>
        <input v-model.number="query.amount_to" type="number" min="0" class="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
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
          <th class="py-2 font-medium">Payment</th>
          <th class="py-2 font-medium">Status</th>
          <th class="py-2 font-medium">Amount</th>
          <th class="py-2 font-medium">Provider</th>
          <th class="py-2 font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="payment in items" :key="payment.payment_id" class="border-b border-slate-100 hover:bg-slate-50">
          <td class="py-2">
            <NuxtLink :to="`/payments/${payment.payment_id}`" class="text-slate-900 hover:underline">
              {{ payment.payment_id.slice(0, 8) }}
            </NuxtLink>
          </td>
          <td class="py-2">{{ payment.status }}</td>
          <td class="py-2">{{ payment.amount ?? '—' }} {{ payment.currency ?? '' }}</td>
          <td class="py-2">{{ payment.provider ?? '—' }}</td>
          <td class="py-2">{{ payment.created_at ? new Date(payment.created_at).toLocaleString() : '—' }}</td>
        </tr>
      </tbody>
    </table>

    <p v-if="!pending && items.length === 0" class="py-6 text-sm text-slate-500">
      No payments match these filters. Note: nothing in core-api creates `payments` rows yet
      (a pre-existing platform gap) — this list is real, and currently empty by default.
    </p>
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
