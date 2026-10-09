import { Controller, Get, Module } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, CurrentActor, RequirePermissions } from '../common/decorators';
import { CustomerResponse } from '../common/dto';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('customers')
@Controller('customers')
@Audiences('customer')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  /** A customer can only ever read their own record (keyed by the session user, never by a client-supplied id). */
  @Get('me')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: CustomerResponse })
  async me(@CurrentActor() actor: Actor) {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      include: { customer: true },
    });
    if (!user?.customer) throw AppError.notFound();
    return {
      userId: user.id,
      displayName: user.displayName,
      mobile: user.mobile,
      email: user.customer.email ?? user.email,
      city: user.customer.city,
      onboardingState: user.customer.onboardingState,
    };
  }
}

@Module({ controllers: [CustomersController] })
export class CustomersModule {}
