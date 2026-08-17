import { defineStore } from 'pinia';
import { toApiError } from '~/utils/apiError';

export interface AdminIdentity {
  userId: string;
  adminRole: string;
  abilities: string[];
}

const STORAGE_KEY = 'admin-web:token';

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

    /** Admins log in through admin-api's own POST /api/v1/admin/auth/login
     * — admin-api verifies the password and mints its own session token directly
     * (see docs/decisions/0011-admin-api-independent-service.md); no
     * call to core-api at all anymore. Then immediately verifies the
     * token against admin-api's own /session — cheap, and fails fast
     * here rather than on the first dashboard fetch if something's
     * wrong with the freshly-issued token. */
    async login(email: string, password: string): Promise<void> {
      const api = useAdminApi();

      let response: { token: string };
      try {
        response = await api.post<{ token: string }>('/api/v1/admin/auth/login', {
          email,
          password,
        });
      } catch (error) {
        throw toApiError(error);
      }

      this.token = response.token;
      if (import.meta.client) {
        localStorage.setItem(STORAGE_KEY, this.token);
      }

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
