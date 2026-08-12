export default defineNuxtRouteMiddleware((to) => {
  const auth = useAuthStore();
  const isLoginPage = to.path === '/login';

  if (!auth.isAuthenticated && !isLoginPage) {
    return navigateTo('/login');
  }

  if (auth.isAuthenticated && isLoginPage) {
    return navigateTo('/dashboard');
  }
});
