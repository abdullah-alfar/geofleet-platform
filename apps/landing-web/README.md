# landing-web

Nuxt 4 / TypeScript / Tailwind 4. The public marketing/portfolio page for the
GeoFleet platform — a standalone site with no auth, no backend calls, and no
relationship to admin-api or core-api at runtime. It exists purely to explain
and showcase the rest of this repository.

This is additive scope, same convention as [apps/admin-web](../admin-web) —
not part of the original 8-phase plan in the repo root
[AGENTS.md](../../AGENTS.md).

## Why SPA mode, not SSR

`ssr: false` in `nuxt.config.ts`. Nuxt still server-renders the static
`<head>` (title/description/OpenGraph tags, configured once in
`nuxt.config.ts`) into the initial HTML, which is what actually matters for
link-preview crawlers — the body itself is dominated by scroll-driven
WebGL/GSAP state that has no server-side meaning. Rendering that on the
server would only reintroduce hydration mismatches between "not scrolled
into view yet" (server) and the client's real scroll position, for no SEO
benefit a page with one route doesn't already get from the static head.

## Structure

```
app/
  app.vue                      NuxtPage + SiteFooter
  pages/index.vue               The entire site — one long scroll, nine sections
  components/
    landing/                    One component per section (HeroSection, ProductDemo, ...)
      demo/                     Small pieces used only inside a section (phone mockups, mini-diagrams)
    three/                      TresJS/Three.js — HeroCityScene, Vehicle, RouteLine
    ui/                         Reveal, SectionHeading, AnimatedCounter, PhoneFrame — shared across sections
  composables/
    useInView.ts                 IntersectionObserver flag — drives every scroll reveal and pause-when-offscreen
    useReducedMotion.ts           prefers-reduced-motion, watched live
    usePageVisible.ts             document.visibilityState — pauses the hero's render loop on a hidden tab
    useGsap.ts                    Registers gsap/ScrollTrigger exactly once, client-only
    useMouseParallax.ts           Normalized pointer position for the hero camera
  assets/css/main.css            Tailwind v4 `@theme` tokens (colors, fonts) + a few global utility classes
```

## Running locally

No other services required — this app makes no API calls.

```bash
cd apps/landing-web
npm install
npm run dev
```

Open http://localhost:3002.

## Performance choices

- `HeroCityScene.vue` (TresJS/Three.js) is loaded via `defineAsyncComponent`
  — three.js/gsap/@tresjs never ship in the initial JS bundle. Verified with
  a production build: the entry chunk is ~51 kB, the three.js/gsap chunk
  (~836 kB unminified) only loads once the hero mounts client-side.
- The hero's render loop pauses (`useLoop().pause()`) when the canvas
  scrolls offscreen or the tab is hidden, and is skipped entirely under
  `prefers-reduced-motion`.
- `devicePixelRatio` is capped at 2; vehicle count and building density
  drop on narrow viewports / low `navigator.hardwareConcurrency`.
- Scroll reveals (`Reveal.vue`) are plain IntersectionObserver + CSS
  transitions, not GSAP ScrollTrigger — cheaper for the ~30 simple
  fade/slide-ins used throughout the page. GSAP is reserved for the counter
  count-up and the hero's route-line draw-in, where a plain CSS transition
  can't do the job.

## A content note

The "Behind the Experience" and "Event-Driven by Design" sections describe
the platform's Kafka-based event flow, including an admin-facing Kafka
projection consumer. That reflects this repository's architecture as
originally specified. **admin-api's own Kafka projection was since removed**
in favor of reading core-api directly (see
[docs/admin-api/query-apis.md](../../docs/admin-api/query-apis.md)) — the
rest of the event-driven flow (outbox → Kafka → location/dispatch/realtime-
gateway) is still accurate. Worth reconciling if this page is meant to track
the platform's current state exactly rather than its original design.
