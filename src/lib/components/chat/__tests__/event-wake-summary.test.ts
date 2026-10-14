import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { isEventWakeMessage } from '../event-wake-summary';

const text =
  '[WORKSPACE EVENTS] Child agent is idle but still waiting on external monitoring — this is NOT its completion.';
function message(metadata?: Record<string, unknown>): AgentMessage {
  return {
    id: 'advisory',
    role: 'user',
    timestamp: '2026-10-14T00:00:00Z',
    metadata,
    contentBlocks: [{ type: 'text', text }],
  };
}

describe('event wake card admission', () => {
  it('keeps a daemon advisory out of completion presentation despite its idle event and legacy prefix', () => {
    expect(
      isEventWakeMessage(
        message({
          type: 'event_notification',
          eventTypes: ['agent:idle'],
          eventCount: 1,
          childExternallyWaiting: true,
          watchStillArmed: true,
        }),
      ),
    ).toBe(false);
  });

  it('preserves current and legacy completion admission without inventing waiting semantics from an armed watch', () => {
    expect(isEventWakeMessage(message({ type: 'event_notification', watchStillArmed: true }))).toBe(
      true,
    );
    expect(
      isEventWakeMessage(message({ type: 'event_notification', childExternallyWaiting: false })),
    ).toBe(true);
    expect(isEventWakeMessage(message())).toBe(true);
  });
});
