import { AnalyticsProjector } from '../src/visibility/analytics-projector.service';
import { MetricsService } from '../src/visibility/metrics.service';
import type { TestApp } from './helpers';

/**
 * Projects analytics for a test. The test database is shared by every suite and can hold a large backlog, so the projector's
 * watermarks are moved forward (never back) to just before this test's own activity; then it catches up and aggregates.
 */
export async function projectSince(t: TestApp, since: Date) {
  const p = t.app.get(AnalyticsProjector);
  for (const source of p.sourceKeys())
    await t.prisma
      .$executeRaw`INSERT INTO "AnalyticsWatermark" ("source", "cursorAt", "updatedAt") VALUES (${source}, ${since}, now())
      ON CONFLICT ("source") DO UPDATE SET "cursorAt" = GREATEST("AnalyticsWatermark"."cursorAt", EXCLUDED."cursorAt")`;
  await p.catchUp();
  await t.app.get(MetricsService).aggregate();
}
