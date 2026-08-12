<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    pending?: boolean;
    variant?: 'danger' | 'default';
  }>(),
  { pending: false, variant: 'default' },
);

const emit = defineEmits<{ confirm: [reason: string] }>();

const isOpen = ref(false);
const reason = ref('');

function open() {
  isOpen.value = true;
}

function cancel() {
  isOpen.value = false;
  reason.value = '';
}

function confirm() {
  emit('confirm', reason.value);
  isOpen.value = false;
  reason.value = '';
}
</script>

<template>
  <div class="inline-block">
    <button
      v-if="!isOpen"
      type="button"
      :disabled="pending"
      class="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      :class="variant === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-900 hover:bg-slate-800'"
      @click="open"
    >
      {{ label }}
    </button>

    <div v-else class="flex items-center gap-2">
      <input
        v-model="reason"
        type="text"
        placeholder="Reason (optional)"
        class="w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      >
      <button
        type="button"
        :disabled="pending"
        class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        @click="confirm"
      >
        {{ pending ? 'Working…' : 'Confirm' }}
      </button>
      <button type="button" class="text-sm text-slate-500 hover:text-slate-900" @click="cancel">
        Cancel
      </button>
    </div>
  </div>
</template>
