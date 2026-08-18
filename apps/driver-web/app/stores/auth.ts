import { defineStore } from 'pinia';
import type { DriverAccountUser } from '~/types/user';
import { toApiError } from '~/utils/apiError';

const STORAGE_KEY = 'driver-web:token';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    user: null as DriverAccountUser | null,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.token !== null,
  },

  actions: {
    restoreToken() {
      if (import.meta.client) {
        this.token = localStorage.getItem(STORAGE_KEY);
      }
    },

    setUser(user: DriverAccountUser) {
      this.user = user;
    },

    async register(input: {
      name: string;
      email: string;
      phone?: string;
      password: string;
      licenseNumber: string;
      licenseExpiresAt: string;
    }): Promise<void> {
      const api = useCoreApi();
      try {
        const response = await api.postWithMeta<DriverAccountUser, { token: string }>(
          '/api/v1/auth/register',
          {
            name: input.name,
            email: input.email,
            phone: input.phone || undefined,
            password: input.password,
            password_confirmation: input.password,
            role: 'driver',
            license_number: input.licenseNumber,
            license_expires_at: input.licenseExpiresAt,
          },
        );
        this.applySession(response.data, response.meta.token);
      } catch (error) {
        throw toApiError(error);
      }
    },

    async login(email: string, password: string): Promise<void> {
      const api = useCoreApi();
      try {
        const response = await api.postWithMeta<DriverAccountUser, { token: string }>(
          '/api/v1/auth/login',
          { email, password },
        );
        this.applySession(response.data, response.meta.token);
      } catch (error) {
        throw toApiError(error);
      }
    },

    /** Re-fetches the full profile (status/vehicle/availability) — used
     * after any command that changes it, so the UI never has to
     * hand-merge a partial update. */
    async refresh(): Promise<void> {
      const api = useCoreApi();
      this.user = await api.get<DriverAccountUser>('/api/v1/auth/me');
    },

    applySession(user: DriverAccountUser, token: string) {
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
