/**
 * Card-meta color tokens — the mock's `wsMeta.c` / `stateMeta.c`. The
 * needs-input/wait state renders the YELLOW warning token (the HUD shell
 * overrides `--warning` to the design-system yellow, `48 96% 53%`), distinct
 * from BLOCKED/FAILED which stay red. Asserting the token wiring here guards
 * the alignment across every wait surface (card banner, WORKSPACES bar,
 * header ATTN, attention panel all read `hsl(var(--warning))`).
 */
import { describe, expect, it } from 'vitest';
import { agentBucketColor, cardStateColor } from './hud-card-meta';

const WARNING = 'hsl(var(--warning))';
const RED = 'hsl(var(--destructive-foreground))';

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
