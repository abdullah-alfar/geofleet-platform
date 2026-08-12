import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the abilities a route requires — checked by PermissionsGuard
 * against the AdminPrincipal's abilities (attached by AuthGuard, which
 * must run first). Multiple permissions are AND-ed: every one must be
 * present (or the principal must hold '*').
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
