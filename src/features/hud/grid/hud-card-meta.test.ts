/**
 * Card-meta color tokens — the mock's `wsMeta.c` / `stateMeta.c`. The
 * needs-input/wait state renders the YELLOW warning token (the HUD shell
 * overrides `--warning` to the design-system yellow, `48 96% 53%`), distinct
 * from BLOCKED/FAILED which stay red. Asserting the token wiring here guards
 * the alignment across every wait surface (card banner, WORKSPACES bar,
 * header ATTN, attention panel all read `hsl(var(--warning))`).
 */
import { describe, expect, it } from 'vitest';
import { HUD_STATE_COLORS, agentBucketColor, cardStateColor } from './hud-card-meta';
import { HUD_FEED_COLORS } from '../right-column/hud-right-column-labels';
import { mapEventToFeedEntry } from '../hud-feed-mapper';
import type { WorkspaceEvent } from '$features/events/types';

const WARNING = 'hsl(var(--warning))';
const RED = 'hsl(var(--destructive-foreground))';
const GREEN = 'hsl(var(--primary))';
const GREY = 'hsl(var(--text-ghost))';
const BLUE = 'hsl(var(--ring))';

describe('cardStateColor wait/blocked/failed tokens', () => {
  it('wait (NEEDS ATTENTION) renders the warning token, not red', () => {
    expect(cardStateColor('wait')).toBe(WARNING);
    expect(cardStateColor('wait')).not.toBe(RED);
  });

  it('blocked and failed stay red (destructive), never the warning token', () => {
    expect(cardStateColor('blocked')).toBe(RED);
    expect(cardStateColor('failed')).toBe(RED);
    expect(cardStateColor('blocked')).not.toBe(WARNING);
  });

  it('non-attention states never borrow the warning token', () => {
    for (const key of ['in_progress', 'complete', 'pr_open', 'pr_merged', 'idle'] as const) {
      expect(cardStateColor(key)).not.toBe(WARNING);
    }
  });

  it('unread renders the blue accent token — non-urgent, never warning/red', () => {
    expect(cardStateColor('unread')).toBe('hsl(var(--ring))');
    expect(cardStateColor('unread')).not.toBe(WARNING);
    expect(cardStateColor('unread')).not.toBe(RED);
  });
});

describe('agentBucketColor', () => {
  it('the needs-attention bucket dot uses the warning (yellow) token', () => {
    expect(agentBucketColor('needs-attention')).toBe(WARNING);
    expect(agentBucketColor('failed')).toBe(RED);
  });

  it('running/done/idle never borrow the warning token', () => {
    for (const bucket of ['running', 'done', 'idle'] as const) {
      expect(agentBucketColor(bucket)).not.toBe(WARNING);
    }
  });
});

describe('canonical HUD state→color mapping (drift pin)', () => {
  // ONE table for every indicator surface: IDLE grey, UNREAD/PR blue,
  // RUNNING green (pulsing at the usage site), ATTENTION yellow, FAILED red,
  // DONE stable green. Asserting the raw tokens here pins drift on ANY
  // surface that resolves through HUD_STATE_COLORS.
  it('HUD_STATE_COLORS carries the canonical tokens', () => {
    expect(HUD_STATE_COLORS).toEqual({
      running: GREEN,
      done: GREEN,
      attention: WARNING,
      failed: RED,
      idle: GREY,
      unread: BLUE,
      pr: BLUE,
      prMerged: 'hsl(262 60% 62%)',
    });
  });

  it('agent squares (card rows / overlay lists) follow the table per bucket', () => {
    expect(agentBucketColor('running')).toBe(HUD_STATE_COLORS.running);
    expect(agentBucketColor('needs-attention')).toBe(HUD_STATE_COLORS.attention);
    expect(agentBucketColor('done')).toBe(HUD_STATE_COLORS.done);
    expect(agentBucketColor('failed')).toBe(HUD_STATE_COLORS.failed);
    expect(agentBucketColor('idle')).toBe(HUD_STATE_COLORS.idle);
  });

  it('card states follow the table per state key', () => {
    expect(cardStateColor('in_progress')).toBe(HUD_STATE_COLORS.running);
    expect(cardStateColor('complete')).toBe(HUD_STATE_COLORS.done);
    expect(cardStateColor('wait')).toBe(HUD_STATE_COLORS.attention);
    expect(cardStateColor('blocked')).toBe(HUD_STATE_COLORS.failed);
    expect(cardStateColor('failed')).toBe(HUD_STATE_COLORS.failed);
    expect(cardStateColor('unread')).toBe(HUD_STATE_COLORS.unread);
    expect(cardStateColor('pr_open')).toBe(HUD_STATE_COLORS.pr);
    expect(cardStateColor('pr_ready')).toBe(HUD_STATE_COLORS.pr);
    expect(cardStateColor('pr_merged')).toBe(HUD_STATE_COLORS.prMerged);
    expect(cardStateColor('idle')).toBe(HUD_STATE_COLORS.idle);
    expect(cardStateColor('not_started')).toBe(HUD_STATE_COLORS.idle);
  });

  it('feed color classes resolve through the same table', () => {
    expect(HUD_FEED_COLORS.ok).toBe(HUD_STATE_COLORS.done);
    expect(HUD_FEED_COLORS.info).toBe(HUD_STATE_COLORS.running);
    expect(HUD_FEED_COLORS.warn).toBe(HUD_STATE_COLORS.attention);
    expect(HUD_FEED_COLORS.err).toBe(HUD_STATE_COLORS.failed);
    expect(HUD_FEED_COLORS.accent).toBe(HUD_STATE_COLORS.pr);
    expect(HUD_FEED_COLORS.idle).toBe(HUD_STATE_COLORS.idle);
  });

  function wireEvent(type: string, data: Record<string, unknown>): WorkspaceEvent {
    return {
      id: `evt-${type}`,
      type,
      timestamp: '2026-07-30T12:00:00Z',
      workspaceId: 'ws-1',
      data,
    } as WorkspaceEvent;
  }

  it('agent lifecycle feed rows color by the state they announce', () => {
    const colorOf = (type: string, data: Record<string, unknown>) => {
      const entry = mapEventToFeedEntry(wireEvent(type, data));
      return entry ? HUD_FEED_COLORS[entry.colorClass] : null;
    };
    // AGENT IDLE feed square is GREY (regression: was green `ok`).
    expect(colorOf('agent:idle', { agentId: 'a1' })).toBe(HUD_STATE_COLORS.idle);
    // RUNNING green, WAITING grey, DONE stable green, FAILED red.
    expect(colorOf('agent:status-changed', { agentId: 'a1', status: 'active' })).toBe(
      HUD_STATE_COLORS.running,
    );
    expect(colorOf('agent:status-changed', { agentId: 'a1', status: 'waiting' })).toBe(
      HUD_STATE_COLORS.idle,
    );
    expect(colorOf('agent:status-changed', { agentId: 'a1', status: 'completed' })).toBe(
      HUD_STATE_COLORS.done,
    );
    expect(colorOf('agent:completed', { agentId: 'a1' })).toBe(HUD_STATE_COLORS.done);
    expect(colorOf('agent:failed', { agentId: 'a1', error: 'x' })).toBe(HUD_STATE_COLORS.failed);
    // Attention rows yellow; idle/not_started workspace statuses grey.
    expect(
      colorOf('workspace:attention-changed', { workspaceId: 'ws-1', attention: 'review_required' }),
    ).toBe(HUD_STATE_COLORS.attention);
    expect(
      colorOf('workspace:displayStatus-changed', { workspaceId: 'ws-1', displayStatus: 'idle' }),
    ).toBe(HUD_STATE_COLORS.idle);
    expect(
      colorOf('workspace:displayStatus-changed', {
        workspaceId: 'ws-1',
        displayStatus: 'needs_attention',
      }),
    ).toBe(HUD_STATE_COLORS.attention);
  });
});
