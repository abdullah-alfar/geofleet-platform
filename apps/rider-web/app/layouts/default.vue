<script setup lang="ts">
const auth = useAuthStore();

function onLogout() {
  auth.logout();
  navigateTo('/login');
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
        <span class="text-sm font-semibold text-slate-900">GeoFleet Rider</span>
        <div class="flex items-center gap-4 text-sm text-slate-500">
          <span v-if="auth.user">{{ auth.user.name }}</span>
          <button type="button" class="text-slate-500 hover:text-slate-900" @click="onLogout">
            Sign out
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-6 py-8">
      <slot />
    </main>
  </div>
</template>
