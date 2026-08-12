import { Module } from '@nestjs/common';
import { DriverStatusChangedHandler } from './handlers/driver-status-changed.handler';
import { DriverLocationValidatedHandler } from './handlers/driver-location-validated.handler';
import { RideRequestedHandler } from './handlers/ride-requested.handler';
import { RideSearchStartedHandler } from './handlers/ride-search-started.handler';
import { RideOfferCreatedHandler } from './handlers/ride-offer-created.handler';
import { RideOfferAcceptedHandler } from './handlers/ride-offer-accepted.handler';
import { RideOfferRejectedHandler } from './handlers/ride-offer-rejected.handler';
import { RideAssignedHandler } from './handlers/ride-assigned.handler';
import { RideUnavailableHandler } from './handlers/ride-unavailable.handler';
import { ProjectionDispatcherService } from './projection-dispatcher.service';
import { PROJECTION_HANDLERS } from './projection-handlers.token';
import { ProjectionHandler } from './handlers/projection-handler.interface';

const HANDLERS = [
  DriverStatusChangedHandler,
  DriverLocationValidatedHandler,
  RideRequestedHandler,
  RideSearchStartedHandler,
  RideOfferCreatedHandler,
  RideOfferAcceptedHandler,
  RideOfferRejectedHandler,
  RideAssignedHandler,
  RideUnavailableHandler,
];

@Module({
  providers: [
    ...HANDLERS,
    {
      provide: PROJECTION_HANDLERS,
      inject: HANDLERS,
      useFactory: (...handlers: ProjectionHandler[]): ProjectionHandler[] =>
        handlers,
    },
    ProjectionDispatcherService,
  ],
  exports: [ProjectionDispatcherService],
})
export class ProjectionsModule {}
