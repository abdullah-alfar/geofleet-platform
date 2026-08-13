import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // SPA mode, same convention as admin-web. Nuxt still server-renders the
  // static <head> (title/description/OG tags below) into the initial HTML
  // for crawlers/link previews even with ssr off — only the body, which is
  // dominated by scroll-driven WebGL/GSAP state, is client-only. That
  // sidesteps a whole class of hydration mismatches between server-frozen
  // "not in view yet" reveal state and the client's real scroll position.
  ssr: false,

  devServer: {
    // 3000 is admin-web, 3001 is admin-api, 8000/8081/8082/8083 are the
    // other services.
    port: 3002,
  },

  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },

  // TresJS elements (<TresMesh>, <TresPerspectiveCamera>, ...) are custom
  // elements resolved at render time by the Tres renderer, not real Vue
  // components — the compiler must be told to leave any `Tres*` tag alone.
  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) =>
        (tag.startsWith('Tres') && !['TresCanvas', 'TresLeches', 'TresScene'].includes(tag)) ||
        tag === 'primitive',
    },
  },

  modules: ['@nuxt/eslint'],

  // Flat component names (<HeroSection>, <Reveal>, ...) regardless of which
  // subfolder they live in — the folder is for organization, not a naming
  // prefix every call site has to repeat.
  components: [
    { path: '~/components/landing', pathPrefix: false },
    { path: '~/components/three', pathPrefix: false },
    { path: '~/components/ui', pathPrefix: false },
  ],

  typescript: {
    strict: true,
    typeCheck: false,
  },

  app: {
    head: {
      title: 'GeoFleet — Movement, orchestrated in real time.',
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'GeoFleet is a scalable ride-hailing and fleet intelligence platform connecting riders, drivers, live GPS, dispatch, and operations through one realtime, event-driven system.',
        },
        { name: 'theme-color', content: '#0b0f19' },
        { property: 'og:title', content: 'GeoFleet — Movement, orchestrated in real time.' },
        {
          property: 'og:description',
          content:
            'A realtime ride-hailing and fleet intelligence platform: live GPS, intelligent dispatch, and event-driven architecture, end to end.',
        },
        { property: 'og:type', content: 'website' },
        { property: 'og:image', content: '/og-cover.svg' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap',
        },
      ],
    },
  },
});
