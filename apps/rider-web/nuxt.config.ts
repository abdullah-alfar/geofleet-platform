import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // A rider's own authenticated session, same reasoning as admin-web's
  // choice of client-only rendering: no SEO/public-page need here, so SSR
  // would only add complexity (forwarding bearer tokens server-side) for
  // no benefit.
  ssr: false,

  devServer: {
    // 3000 admin-web, 3001 admin-api, 3002 landing-web, 8000/8081/8082/8083
    // core-api + the three Go services — 3003 is free.
    port: 3003,
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
      // Overridable via NUXT_PUBLIC_CORE_API_BASE_URL / NUXT_PUBLIC_REALTIME_GATEWAY_WS_URL
      // (see .env.example). Unlike admin-web (which talks only to
      // admin-api — see docs/decisions/0011), a rider is a genuine
      // core-api customer: registration, login, and ride requests all go
      // straight to core-api's own public API. Live driver tracking goes
      // to realtime-gateway's WebSocket, not core-api or admin-api.
      coreApiBaseUrl: 'http://localhost:8000',
      realtimeGatewayWsUrl: 'ws://localhost:8083',
    },
  },
});
