import { Global, Module } from '@nestjs/common';
import type { ApiEnv } from '@dealdash/config';
import { APP_ENV } from '../common/env';
import {
  EMAIL_PROVIDER,
  FILE_SCANNER,
  MAPS_PROVIDER,
  PAYMENT_PROVIDER,
  PUSH_PROVIDER,
  SMS_PROVIDER,
  STORAGE_PROVIDER,
  VIDEO_PROVIDER,
} from './interfaces';
import { DevFileScanner, LocalStorageProvider } from './local-storage';
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
        env.STORAGE_PROVIDER === 'local'
          ? new LocalStorageProvider(env.STORAGE_LOCAL_DIR, env.API_PUBLIC_URL, env.SESSION_SECRET)
          : new MockStorageProvider(),
    },
    { provide: FILE_SCANNER, useClass: DevFileScanner },
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
  ],
})
export class ProvidersModule {}
