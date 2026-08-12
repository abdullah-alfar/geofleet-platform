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
      // Everything except login goes here.
      adminApiBaseUrl: 'http://localhost:3001',
      // Overridable via NUXT_PUBLIC_CORE_API_BASE_URL. Admins log in
      // through core-api's shared POST /api/v1/auth/login (same endpoint
      // customers/drivers use — see ADR 0009, no separate admin identity
      // system) — the *only* call this app ever makes to core-api
      // directly. Every other request goes to admin-api.
      coreApiBaseUrl: 'http://localhost:8000',
    },
  },
});
