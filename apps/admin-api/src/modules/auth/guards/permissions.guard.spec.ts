import {
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function contextWith(
  admin: { abilities: string[] } | undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ admin }),
    }),
    getHandler: () => (() => undefined) as unknown,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function reflectorReturning(value: string[] | undefined): Reflector {
  return {
    getAllAndOverride: () => value,
  } as unknown as Reflector;
}

describe('PermissionsGuard', () => {
  it('allows when the route has no @RequirePermissions() metadata', () => {
    const guard = new PermissionsGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextWith({ abilities: [] }))).toBe(true);
  });

  it('allows when the required permissions array is empty', () => {
    const guard = new PermissionsGuard(reflectorReturning([]));
    expect(guard.canActivate(contextWith({ abilities: [] }))).toBe(true);
  });

  it("allows a '*' ability regardless of what's required", () => {
    const guard = new PermissionsGuard(
      reflectorReturning(['payments.refund', 'drivers.suspend']),
    );
    expect(guard.canActivate(contextWith({ abilities: ['*'] }))).toBe(true);
  });

  it('allows when every required permission is present', () => {
    const guard = new PermissionsGuard(
      reflectorReturning(['dashboard.view', 'trips.view']),
    );
    expect(
      guard.canActivate(
        contextWith({
          abilities: ['dashboard.view', 'trips.view', 'rides.view'],
        }),
      ),
    ).toBe(true);
  });

  it('throws ForbiddenException when a required permission is missing', () => {
    const guard = new PermissionsGuard(
      reflectorReturning(['dashboard.view', 'payments.refund']),
    );
    expect(() =>
      guard.canActivate(contextWith({ abilities: ['dashboard.view'] })),
    ).toThrow(ForbiddenException);
  });

  it('throws InternalServerErrorException if AuthGuard never ran', () => {
    const guard = new PermissionsGuard(reflectorReturning(['dashboard.view']));
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(
      InternalServerErrorException,
    );
  });
});
