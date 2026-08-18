import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Same reasoning as rider-web/admin-web: an authenticated-only app, no
  // SEO/public-page need, so SSR would only add complexity for no benefit.
  ssr: false,

  devServer: {
    // 3000 admin-web, 3001 admin-api, 3002 landing-web, 3003 rider-web,
    // 8000/8081/8082/8083 core-api + the three Go services — 3004 is free.
    port: 3004,
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
      // core-api: auth, device/vehicle registration, availability.
      // dispatch-service: ride-offer accept/reject/pending (the device
      // token, not the Sanctum user token — see AGENTS.md's "two
      // separate driver credentials" convention).
      // location-service: GPS pings (same device token).
      // realtime-gateway: driver WebSocket (same device token again),
      // pushes ride.offer.created the instant it's created instead of
      // leaving this app to poll dispatch-service on a timer.
      coreApiBaseUrl: 'http://localhost:8000',
      dispatchServiceBaseUrl: 'http://localhost:8082',
      locationServiceBaseUrl: 'http://localhost:8081',
      realtimeGatewayWsUrl: 'ws://localhost:8083',
    },
  },
});
