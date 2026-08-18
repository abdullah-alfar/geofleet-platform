export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore();
  const isAuthPage = to.path === '/login' || to.path === '/register';

  if (!auth.isAuthenticated && !isAuthPage) {
    return navigateTo('/login');
  }

  if (auth.isAuthenticated && isAuthPage) {
    return navigateTo('/drive');
  }
});
