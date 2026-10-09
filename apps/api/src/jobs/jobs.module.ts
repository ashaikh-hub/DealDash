import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  type OnModuleInit,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, RequirePermissions } from '../common/decorators';
import { EnqueueDemoJobDto, JobListResponse, JobResponse } from '../common/dto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import { JobsService } from './jobs.service';

const view = (j: {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
}) => ({
  id: j.id,
  type: j.type,
  status: j.status as 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD',
  attempts: j.attempts,
  maxAttempts: j.maxAttempts,
  lastError: j.lastError,
  createdAt: j.createdAt.toISOString(),
});

@ApiTags('admin')
@Controller('admin/jobs')
@Audiences('admin')
export class AdminJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequirePermissions('admin.jobs.manage')
  @ApiOkResponse({ type: JobListResponse })
  async list() {
    return (await this.jobs.list()).map(view);
  }

  @Get(':id')
  @RequirePermissions('admin.jobs.manage')
  @ApiOkResponse({ type: JobResponse })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const job = await this.jobs.get(id);
    if (!job) throw AppError.notFound();
    return view(job);
  }

  /** Demonstrates the framework: enqueue a job that can be told to fail N times before succeeding. */
  @Post('demo')
  @RequirePermissions('admin.jobs.manage')
  @ApiOkResponse({ type: JobResponse })
  async enqueueDemo(@Body() body: EnqueueDemoJobDto) {
    return view(
      await this.jobs.enqueue(
        'demo.echo',
        { message: body.message, failTimes: body.failTimes },
        { idempotencyKey: body.idempotencyKey },
      ),
    );
  }
}

@Module({ controllers: [AdminJobsController], providers: [JobsService], exports: [JobsService] })
export class JobsModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    // Framework demonstration handler. Real product jobs register their own handlers in later stages.
    this.jobs.register('demo.echo', async (payload, ctx) => {
      const failTimes = Number(payload.failTimes ?? 0);
      if (ctx.attempt <= failTimes) throw new Error(`Simulated failure on attempt ${ctx.attempt}`);
      return { echoed: payload.message, attempts: ctx.attempt };
    });
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false')
      this.jobs.start();
  }
}
