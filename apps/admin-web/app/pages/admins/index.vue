<script setup lang="ts">
import type { AdminAccountRow } from '~/types/admin-account';
import { ADMIN_ROLES } from '~/types/admin-account';

const api = useAdminApi();
const auth = useAuthStore();
const command = useAdminCommand();
const successMessage = ref<string | null>(null);

const {
  data: admins,
  pending,
  error,
  refresh,
} = useAsyncData('admins-list', () => api.get<AdminAccountRow[]>('/api/v1/admin/admins'));

function isSelf(admin: AdminAccountRow): boolean {
  return admin.user_id === auth.admin?.userId;
}

async function onRoleChange(admin: AdminAccountRow, event: Event) {
  const newRole = (event.target as HTMLSelectElement).value;
  if (newRole === admin.admin_role) return;

  successMessage.value = null;
  const result = await command.runWithBody<{ admin_role: string }>(
    `/api/v1/admin/admins/${admin.id}/role`,
    { admin_role: newRole },
  );
  if (result) {
    successMessage.value = `${admin.name}'s role changed to ${result.admin_role}. Takes effect on their next login (their current session keeps its old abilities — see docs/admin-api/permissions.md).`;
    await refresh();
  } else {
    // Revert the <select> visually — the request failed, admin.admin_role
    // in the fetched list is still the true value once refresh() below
    // would run, but nothing changed here, so just re-render from state.
    await refresh();
  }
}

async function onDeactivate(admin: AdminAccountRow, reason: string) {
  successMessage.value = null;
  const result = await command.run<{ status: string }>(
    `/api/v1/admin/admins/${admin.id}/deactivate`,
    reason || undefined,
  );
  if (result) {
    successMessage.value = `${admin.name} deactivated. They're locked out immediately, not just on next login.`;
    await refresh();
  }
}
</script>

<template>
  <div>
    <h1 class="mb-6 text-lg font-semibold text-slate-900">Admin accounts</h1>

    <p class="mb-4 text-sm text-slate-500">
      New admins are provisioned out-of-band (<code>php artisan admin:create</code>) — this page
      only manages accounts that already exist.
    </p>

    <p v-if="error" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error.message }}
    </p>
    <p v-if="command.error.value" class="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ command.error.value.message }}
    </p>
    <p v-if="successMessage" class="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
      {{ successMessage }}
    </p>
    <p v-if="pending" class="text-sm text-slate-500">Loading…</p>

    <table v-else-if="admins && admins.length > 0" class="w-full text-left text-sm">
      <thead>
        <tr class="border-b border-slate-200 text-slate-500">
          <th class="py-2 font-medium">Name</th>
          <th class="py-2 font-medium">Email</th>
          <th class="py-2 font-medium">Role</th>
          <th class="py-2 font-medium">Status</th>
          <th class="py-2 font-medium">Created</th>
          <th class="py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="admin in admins" :key="admin.id" class="border-b border-slate-100">
          <td class="py-2 text-slate-900">
            {{ admin.name }}
            <span v-if="isSelf(admin)" class="ml-1 text-xs text-slate-400">(you)</span>
          </td>
          <td class="py-2">{{ admin.email }}</td>
          <td class="py-2">
            <select
              :value="admin.admin_role"
              :disabled="isSelf(admin) || command.pending.value"
              class="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
              @change="onRoleChange(admin, $event)"
            >
              <option v-for="role in ADMIN_ROLES" :key="role" :value="role">{{ role }}</option>
            </select>
          </td>
          <td class="py-2">
            {{ admin.status }}
            <span
              v-if="admin.status === 'disabled'"
              class="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700"
            >
              deactivated
            </span>
          </td>
          <td class="py-2">
            {{ admin.created_at ? new Date(admin.created_at).toLocaleDateString() : '—' }}
          </td>
          <td class="py-2">
            <CommandButton
              v-if="!isSelf(admin) && admin.status !== 'disabled'"
              label="Deactivate"
              variant="danger"
              :pending="command.pending.value"
              @confirm="(reason) => onDeactivate(admin, reason)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="text-sm text-slate-500">No admin accounts found.</p>
  </div>
</template>
