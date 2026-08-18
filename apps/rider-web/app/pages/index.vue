<script setup lang="ts">
// auth.global.ts already redirects unauthenticated visitors to /login —
// this page just sends everyone else on to the one thing this app does.
await navigateTo('/ride');
</script>

<template />
