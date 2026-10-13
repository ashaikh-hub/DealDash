import { Global, Module } from '@nestjs/common';
import type { ApiEnv } from '@dealdash/config';
import { APP_ENV } from '../common/env';
import {
  EMAIL_PROVIDER,
  FILE_SCANNER,
  MAPS_PROVIDER,
  PAYMENT_PROVIDER,
  PAYOUT_PROVIDER,
  PUSH_PROVIDER,
  SMS_PROVIDER,
  STORAGE_PROVIDER,
  VIDEO_PROVIDER,
} from './interfaces';
import { DevFileScanner, LocalStorageProvider } from './local-storage';
import { ManualPayoutProvider, MockPayoutProvider } from './payout';
import { S3StorageProvider } from './s3-storage';
import {
  MockEmailProvider,
  MockMapsProvider,
  MockPaymentProvider,
  MockPushProvider,
  MockSmsProvider,
  MockStorageProvider,
  MockVideoProvider,
} from './mocks';

/**
 * Provider wiring. Only development adapters exist today; adding a real vendor means adding an adapter class and a
 * switch case here. No business module imports a vendor SDK.
 */
@Global()
@Module({
  providers: [
    { provide: SMS_PROVIDER, useClass: MockSmsProvider },
    { provide: EMAIL_PROVIDER, useClass: MockEmailProvider },
    { provide: PUSH_PROVIDER, useClass: MockPushProvider },
    { provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider },
    {
      provide: STORAGE_PROVIDER,
      inject: [APP_ENV],
      useFactory: (env: ApiEnv) =>
        env.STORAGE_PROVIDER === 's3'
          ? new S3StorageProvider({
              endpoint: env.S3_ENDPOINT ?? '',
              bucket: env.S3_BUCKET ?? '',
              region: env.S3_REGION,
              accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
              secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
              pathStyle: env.S3_PATH_STYLE,
            })
          : env.STORAGE_PROVIDER === 'local'
            ? new LocalStorageProvider(
                env.STORAGE_LOCAL_DIR,
                env.API_PUBLIC_URL,
                env.SESSION_SECRET,
              )
            : new MockStorageProvider(),
    },
    { provide: FILE_SCANNER, useClass: DevFileScanner },
    // Stage 9 (B2): settlement payouts (manual by default; a vendor adapter is added when contracted)
    {
      provide: PAYOUT_PROVIDER,
      inject: [APP_ENV],
      useFactory: (env: ApiEnv) =>
        env.PAYOUT_PROVIDER === 'mock' ? new MockPayoutProvider() : new ManualPayoutProvider(),
    },
    { provide: VIDEO_PROVIDER, useClass: MockVideoProvider },
    { provide: MAPS_PROVIDER, useClass: MockMapsProvider },
  ],
  exports: [
    SMS_PROVIDER,
    EMAIL_PROVIDER,
    PUSH_PROVIDER,
    PAYMENT_PROVIDER,
    STORAGE_PROVIDER,
    FILE_SCANNER,
    VIDEO_PROVIDER,
    MAPS_PROVIDER,
    PAYOUT_PROVIDER,
  ],
})
export class ProvidersModule {}
