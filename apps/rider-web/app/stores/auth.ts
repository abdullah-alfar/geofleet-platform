import { defineStore } from 'pinia';
import type { RiderUser } from '~/types/user';
import { toApiError } from '~/utils/apiError';

const STORAGE_KEY = 'rider-web:token';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    user: null as RiderUser | null,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.token !== null,
  },

  actions: {
    /** Reads the token back on app boot — see app/plugins/auth.client.ts. */
    restoreToken() {
      if (import.meta.client) {
        this.token = localStorage.getItem(STORAGE_KEY);
      }
    },

    setUser(user: RiderUser) {
      this.user = user;
    },

    /** core-api issues a Sanctum token with full '*' abilities for
     * customer/driver accounts (App\Http\Controllers\Api\V1\AuthController::register) —
     * unlike admin accounts, there's no restricted ability set to fetch
     * afterward, so the register response's own `data` is the user. */
    async register(input: {
      name: string;
      email: string;
      phone?: string;
      password: string;
    }): Promise<void> {
      const api = useCoreApi();
      try {
        const response = await api.postWithMeta<RiderUser, { token: string }>('/api/v1/auth/register', {
          name: input.name,
          email: input.email,
          phone: input.phone || undefined,
          password: input.password,
          password_confirmation: input.password,
          role: 'customer',
        });
        this.applySession(response.data, response.meta.token);
      } catch (error) {
        throw toApiError(error);
      }
    },

    async login(email: string, password: string): Promise<void> {
      const api = useCoreApi();
      try {
        const response = await api.postWithMeta<RiderUser, { token: string }>('/api/v1/auth/login', {
          email,
          password,
        });
        this.applySession(response.data, response.meta.token);
      } catch (error) {
        throw toApiError(error);
      }
    },

    applySession(user: RiderUser, token: string) {
      this.token = token;
      this.user = user;
      if (import.meta.client) {
        localStorage.setItem(STORAGE_KEY, token);
      }
    },

    logout() {
      this.token = null;
      this.user = null;
      if (import.meta.client) {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
  },
});
