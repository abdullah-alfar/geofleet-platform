<script setup lang="ts">
definePageMeta({ layout: false });

const email = ref('');
const password = ref('');
const errorMessage = ref<string | null>(null);
const isSubmitting = ref(false);

const auth = useAuthStore();

async function onSubmit() {
  errorMessage.value = null;
  isSubmitting.value = true;
  try {
    await auth.login(email.value, password.value);
    await navigateTo('/ride');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Login failed.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-100">
    <div class="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
      <h1 class="mb-1 text-xl font-semibold text-slate-900">GeoFleet Rider</h1>
      <p class="mb-6 text-sm text-slate-500">Sign in to request a ride.</p>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div>
          <label for="email" class="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="username"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          >
        </div>

        <div>
          <label for="password" class="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          >
        </div>

        <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {{ isSubmitting ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="mt-4 text-center text-sm text-slate-500">
        No account? <NuxtLink to="/register" class="text-slate-900 underline">Register</NuxtLink>
      </p>
    </div>
  </div>
</template>
