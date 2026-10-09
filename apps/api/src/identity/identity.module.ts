import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActorService } from './actor.service';
import { AuthController } from './auth.controller';
import { AuthGuard, PermissionsGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TenantService } from './tenant.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    ActorService,
    AuthService,
    SessionService,
    TenantService,
    // Order matters: authenticate first, then authorise.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [ActorService, AuthService, SessionService, TenantService],
})
export class IdentityModule {}
