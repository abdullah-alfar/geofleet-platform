<script setup lang="ts">
/**
 * Only lists nav links to pages that actually exist — Phase 1 built just
 * the dashboard. Drivers/rides/trips/payments/live-map links are added
 * here as each one's own phase actually builds the page, not ahead of
 * it (a nav link to a 404 is worse than no link).
 */
interface NavItem {
  to: string;
  label: string;
  ability: string;
}

const navItems: NavItem[] = [{ to: '/dashboard', label: 'Dashboard', ability: 'dashboard.view' }];

const auth = useAuthStore();

function onLogout() {
  auth.logout();
  navigateTo('/login');
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div class="flex items-center gap-8">
          <span class="text-sm font-semibold text-slate-900">GeoFleet Admin</span>
          <nav class="flex gap-4">
            <NuxtLink
              v-for="item in navItems.filter((i) => auth.hasAbility(i.ability))"
              :key="item.to"
              :to="item.to"
              class="text-sm text-slate-600 hover:text-slate-900"
              active-class="text-slate-900 font-medium"
            >
              {{ item.label }}
            </NuxtLink>
          </nav>
        </div>

        <div class="flex items-center gap-4 text-sm text-slate-500">
          <span v-if="auth.admin">{{ auth.admin.adminRole }}</span>
          <button type="button" class="text-slate-500 hover:text-slate-900" @click="onLogout">
            Sign out
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-6 py-8">
      <slot />
    </main>
  </div>
</template>
