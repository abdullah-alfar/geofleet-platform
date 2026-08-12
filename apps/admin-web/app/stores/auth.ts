import { defineStore } from 'pinia';
import { toApiError } from '~/utils/apiError';

export interface AdminIdentity {
  userId: string;
  adminRole: string;
  abilities: string[];
}

const STORAGE_KEY = 'admin-web:token';

interface LoginResponse {
  data: { role: string };
  meta: { token: string };
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    admin: null as AdminIdentity | null,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.token !== null,
    /** `'*'` (super_admin's wildcard, Sanctum's own convention) always
     * passes — same rule admin-api's own PermissionsGuard applies. */
    hasAbility:
      (state) =>
      (ability: string): boolean => {
        if (!state.admin) return false;
        return (
          state.admin.abilities.includes('*') ||
          state.admin.abilities.includes(ability)
        );
      },
  },

  actions: {
    /** Reads the token back on app boot — see app/plugins/auth.client.ts.
     * `admin` (role/abilities) is deliberately *not* persisted alongside
     * it: re-deriving it from admin-api's own /session on every boot is
     * the single source of truth and fails fast if the token has been
     * revoked, rather than trusting stale client-side state. */
    restoreToken() {
      if (import.meta.client) {
        this.token = localStorage.getItem(STORAGE_KEY);
      }
    },

    setAdmin(admin: AdminIdentity) {
      this.admin = admin;
    },

    /** Admins log in through core-api's shared POST /api/v1/auth/login —
     * the same endpoint customers/drivers use, not a separate admin
     * identity system (see docs/decisions/0009-admin-identity.md). Then
     * immediately verifies the token against admin-api's own /session —
     * cheap, and fails fast here rather than on the first dashboard
     * fetch if admin-api can't actually verify it (e.g. a misconfigured
     * shared Postgres connection between the two services). */
    async login(email: string, password: string): Promise<void> {
      const config = useRuntimeConfig();

      let response: LoginResponse;
      try {
        response = await $fetch<LoginResponse>('/api/v1/auth/login', {
          baseURL: config.public.coreApiBaseUrl,
          method: 'POST',
          body: { email, password },
        });
      } catch (error) {
        throw toApiError(error);
      }

      if (response.data.role !== 'admin') {
        throw new Error(
          'This account is not an admin account — customer/driver logins are not accepted here.',
        );
      }

      this.token = response.meta.token;
      if (import.meta.client) {
        localStorage.setItem(STORAGE_KEY, this.token);
      }

      const api = useAdminApi();
      this.admin = await api.get<AdminIdentity>('/api/v1/admin/session');
    },

    logout() {
      this.token = null;
      this.admin = null;
      if (import.meta.client) {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
  },
});
