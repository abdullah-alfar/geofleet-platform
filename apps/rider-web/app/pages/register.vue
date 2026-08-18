<script setup lang="ts">
definePageMeta({ layout: false });

const name = ref('');
const email = ref('');
const phone = ref('');
const password = ref('');
const errorMessage = ref<string | null>(null);
const isSubmitting = ref(false);

const auth = useAuthStore();

async function onSubmit() {
  errorMessage.value = null;
  isSubmitting.value = true;
  try {
    await auth.register({
      name: name.value,
      email: email.value,
      phone: phone.value,
      password: password.value,
    });
    await navigateTo('/ride');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Registration failed.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-100">
    <div class="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
      <h1 class="mb-1 text-xl font-semibold text-slate-900">GeoFleet Rider</h1>
      <p class="mb-6 text-sm text-slate-500">Create a rider account.</p>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div>
          <label for="name" class="mb-1 block text-sm font-medium text-slate-700">Name</label>
          <input
            id="name"
            v-model="name"
            type="text"
            required
            autocomplete="name"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          >
        </div>

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
          <label for="phone" class="mb-1 block text-sm font-medium text-slate-700">Phone (optional)</label>
          <input
            id="phone"
            v-model="phone"
            type="tel"
            autocomplete="tel"
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
            minlength="8"
            autocomplete="new-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          >
        </div>

        <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {{ isSubmitting ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      <p class="mt-4 text-center text-sm text-slate-500">
        Already have an account? <NuxtLink to="/login" class="text-slate-900 underline">Sign in</NuxtLink>
      </p>
    </div>
  </div>
</template>
