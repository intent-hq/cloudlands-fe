import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { getAutomatedWakePresentation } from '../automated-wake-presentation';

function message(text: string, metadata?: Record<string, unknown>): AgentMessage {
  return {
    id: 'wake-1',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date('2026-08-14T00:00:00.000Z'),
    ...(metadata ? { metadata } : {}),
  };
}

describe('automated wake presentation', () => {
  it('prefers hook metadata and suppresses raw hook and queue state notes', () => {
    const presentation = getAutomatedWakePresentation(
      message(
        '[Background hook "build"] Build failed\n\n' +
          '[This hook is now retired and will not run again.]\n\n' +
          '[SYSTEM NOTE] This message was queued at 2026-08-14T00:00:00.000Z and waited 3s before delivery.',
        {
          type: 'hook_wake',
          hookId: 'hook-1',
          hookName: 'build',
          reason: 'dispatched',
          hookStillActive: false,
          queueInfo: { queuedAt: '2026-08-14T00:00:00.000Z', waitedMs: 3000 },
        },
      ),
    );

    expect(presentation).toMatchObject({
      kind: 'hook',
      state: 'retired',
      bodyText: 'Build failed',
      queueInfo: { waitedMs: 3000 },
    });
  });

  it.each([
    ['[Background hook "tests"] Tests passed', 'hook', 'Tests passed'],
    ['[PR monitor intent-hq/monorepo#42] Checks passed', 'pr', 'Checks passed'],
  ] as const)('uses the legacy %s prefix fallback', (text, kind, bodyText) => {
    expect(getAutomatedWakePresentation(message(text))).toMatchObject({ kind, bodyText });
  });

  it('reads PR metadata from a persisted text block before legacy content', () => {
    const wake = message('[PR monitor wrong/repo#9] Review requested');
    wake.contentBlocks = [
      {
        type: 'text',
        text: '[PR monitor wrong/repo#9] Review requested',
        messageMetadata: {
          type: 'pr_monitor_wake',
          monitorId: 'monitor-1',
          repo: 'intent-hq/intentd',
          prNumber: 1170,
          reason: 'review_requested',
        },
      },
    ];

    const presentation = getAutomatedWakePresentation(wake);
    expect(presentation).toMatchObject({
      kind: 'pr',
      attribution: { repo: 'intent-hq/intentd', prNumber: 1170 },
    });
  });

  it('leaves ordinary and assistant messages unclassified', () => {
    expect(getAutomatedWakePresentation(message('Human message'))).toBeNull();
    expect(
      getAutomatedWakePresentation({ ...message('[Background hook "x"] body'), role: 'assistant' }),
    ).toBeNull();
  });
});
