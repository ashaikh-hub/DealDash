import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AdminAuditController } from './audit.controller';

@Global()
@Module({ providers: [AuditService], controllers: [AdminAuditController], exports: [AuditService] })
export class AuditModule {}
