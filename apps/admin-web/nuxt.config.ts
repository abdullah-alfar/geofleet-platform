import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Internal, authenticated-only admin tool — no SEO/public-page need, so
  // SSR would only add complexity (forwarding bearer tokens server-side,
  // hydration mismatches on auth-gated content) for no benefit. Same
  // reasoning already applied when choosing this stack over Next.js.
  ssr: false,

  devServer: {
    // 3001 is admin-api, 8000/8081/8082/8083 are the other services —
    // 3000 (Nuxt's own default) is free.
    port: 3000,
  },

  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },

  modules: ['@pinia/nuxt', '@nuxt/eslint'],

  typescript: {
    strict: true,
    typeCheck: false,
  },

  runtimeConfig: {
    public: {
      // Overridable via NUXT_PUBLIC_ADMIN_API_BASE_URL — see .env.example.
      // Every request this app makes goes here, including login —
      // admin-api is now fully independent of core-api (see
      // docs/decisions/0011-admin-api-independent-service.md).
      adminApiBaseUrl: 'http://localhost:3001',
    },
  },
});
