import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import { ConfigListResponse, ConfigResponse, UpdateConfigDto } from '../common/dto';
import type { Actor, RequestMeta } from '../common/request-context';
import { SystemConfigService } from './system-config.service';

const view = (r: {
  key: string;
  value: unknown;
  description: string | null;
  version: number;
  updatedAt: Date;
}) => ({
  key: r.key,
  value: r.value,
  description: r.description,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

@ApiTags('admin')
@Controller('admin/config')
@Audiences('admin')
export class AdminConfigController {
  constructor(private readonly config: SystemConfigService) {}

  @Get()
  @RequirePermissions('admin.config.read')
  @ApiOkResponse({ type: ConfigListResponse })
  async list() {
    return (await this.config.list()).map(view);
  }

  @Put(':key')
  @RequirePermissions('admin.config.manage')
  @ApiOkResponse({ type: ConfigResponse })
  async update(
    @Param('key') key: string,
    @Body() body: UpdateConfigDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return view(await this.config.set(key, body.value, body.reason, actor, meta));
  }
}
