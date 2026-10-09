import { Global, Module } from '@nestjs/common';
import { AdminConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Global()
@Module({
  providers: [SystemConfigService],
  controllers: [AdminConfigController],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
