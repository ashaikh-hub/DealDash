import { describe, expect, it, vi } from 'vitest';
import {
  BatchingAnalyticsClient,
  ConsoleAnalyticsSink,
  analyticsBatchSchema,
  createAnalyticsEvent,
} from './index';

describe('analytics contract', () => {
  it('creates typed events with defaults and a timestamp', () => {
    const e = createAnalyticsEvent({ name: 'screen.viewed', properties: { screen: 'home' } });
    expect(e.name).toBe('screen.viewed');
    expect(new Date(e.timestamp).getTime()).toBeGreaterThan(0);
    expect(e.context).toEqual({});
  });

  it('rejects unknown event names and oversized batches', () => {
    expect(() => createAnalyticsEvent({ name: 'nope' as never })).toThrow();
    const e = createAnalyticsEvent({ name: 'app.opened' });
    expect(analyticsBatchSchema.safeParse({ events: Array(101).fill(e) }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ events: [e] }).success).toBe(true);
  });

  it('console sink buffers and logs', () => {
    const log = vi.fn();
    const sink = new ConsoleAnalyticsSink({ log, maxBuffer: 2 });
    for (let i = 0; i < 3; i++) sink.track(createAnalyticsEvent({ name: 'app.opened' }));
    expect(sink.buffer).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('batching client flushes and keeps events when the transport fails', async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const client = new BatchingAnalyticsClient(transport);
    client.track({ name: 'app.opened' });
    await client.flush();
    expect(client.pending).toBe(1);
    await client.flush();
    expect(client.pending).toBe(0);
  });
});
