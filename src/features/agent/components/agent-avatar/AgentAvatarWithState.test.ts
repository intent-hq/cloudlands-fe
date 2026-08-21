import { cleanup, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import { getAvatarState, type AvatarState } from './avatar-state';
import AgentAvatarWithState from './AgentAvatarWithState.svelte';
import { agentAvatarCatalogStates, agentAvatarCatalogIdentities } from './agent-avatar.catalog';
import { getAgentAvatarStateLabel } from './avatar-state-label';
import { agentAvatarGeometry, agentAvatarVariants } from './avatar-size';

const source = readFileSync(
  resolve(process.cwd(), 'src/features/agent/components/agent-avatar/AgentAvatarWithState.svelte'),
  'utf8',
);
const avatarSource = readFileSync(
  resolve(process.cwd(), 'src/features/agent/components/agent-avatar/AgentAvatar.svelte'),
  'utf8',
);
const tokenSource = readFileSync(resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
const stackSource = readFileSync(
  resolve(process.cwd(), 'src/features/agent/components/agent-avatar/AgentAvatarStack.svelte'),
  'utf8',
);
const catalogSource = readFileSync(
  resolve(process.cwd(), 'src/features/agent/components/agent-avatar/AgentAvatarCatalog.svelte'),
  'utf8',
);
const tabSource = readFileSync(
  resolve(process.cwd(), 'src/features/layout/components/panel-tabs/Tab.svelte'),
  'utf8',
);

type Rgb = readonly [number, number, number];

const waitingSurfaceByTheme = {
  light: { channels: '263.2 74.257% 80.196%', rgb: [196, 167, 242] },
  dark: { channels: '259.024 64.063% 74.902%', rgb: [176, 150, 232] },
} as const satisfies Record<'light' | 'dark', { channels: string; rgb: Rgb }>;

const workspaceUnreadSurfaceByTheme = {
  light: { channels: '217.2 91.2% 59.8%', rgb: [59, 130, 246] },
  dark: { channels: '213.1 93.9% 67.8%', rgb: [96, 165, 250] },
} as const satisfies Record<'light' | 'dark', { channels: string; rgb: Rgb }>;

const otherSurfaceRgbByTheme = {
  light: [
    [232, 237, 234],
    [255, 162, 64],
    [209, 226, 78],
    [59, 130, 246],
  ],
  dark: [
    [192, 206, 198],
    [255, 181, 102],
    [222, 237, 110],
    [96, 165, 250],
  ],
} as const satisfies Record<'light' | 'dark', readonly Rgb[]>;

function colorDistance(first: Rgb, second: Rgb): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function contrastWithReferenceGlyph(background: Rgb): number {
  const luminance = ([red, green, blue]: Rgb) => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  };
  return (luminance(background) + 0.05) / (luminance([8, 8, 8]) + 0.05);
}

afterEach(cleanup);

describe('AgentAvatarWithState', () => {
  it.each(agentAvatarCatalogStates)('keeps %s accessible without an overlay', (state) => {
    const { container } = render(AgentAvatarWithState, {
      props: { agentId: 'state-agent', specialist: 'verifier', state },
    });
    const avatar = screen.getByRole('img', { name: getAgentAvatarStateLabel(state) });

    expect(avatar.getAttribute('title')).toBe(getAgentAvatarStateLabel(state));
    expect(avatar.getAttribute('data-avatar-state')).toBe(state);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('[data-avatar-overlay], [data-icon], img')).toBeNull();
  });

  it('changes only the state class and surface presentation', async () => {
    const view = render(AgentAvatarWithState, {
      props: {
        agentId: 'stable-agent',
        specialist: 'implementor',
        state: 'idle',
        variant: 'standard',
      },
    });
    const svgMarkup = view.container.querySelector('svg')?.innerHTML;
    const design = view.container.querySelector('svg')?.getAttribute('data-avatar-design');

    for (const state of agentAvatarCatalogStates) {
      await view.rerender({
        agentId: 'stable-agent',
        specialist: 'implementor',
        state,
        variant: 'standard',
      });
      expect(view.container.querySelector('svg')?.innerHTML).toBe(svgMarkup);
      expect(view.container.querySelector('svg')?.getAttribute('data-avatar-design')).toBe(design);
      expect(view.container.querySelector('[data-agent-avatar-with-state]')?.className).toContain(
        `agent-avatar-with-state--${state}`,
      );
    }
  });

  it('uses theme-scoped semantic surfaces and fixed reference-art color', () => {
    expect(source).toContain('data-agent-avatar-surface');
    expect(source).toContain('border-radius: var(--agent-avatar-corner-radius, 6px)');
    expect(source).toContain('clip-path: inset(0 round var(--agent-avatar-corner-radius, 6px))');
    expect(source).not.toContain('::after');
    expect(source).not.toContain('box-shadow');
    expect(source).toContain('hsl(var(--agent-avatar-surface-neutral))');
    expect(source).toContain('hsl(var(--agent-avatar-surface-completed))');
    expect(source).toContain('hsl(var(--agent-avatar-foreground-completed))');
    expect(source).toMatch(/agent-avatar-with-state--completed\s*{[^}]*transition: none/);
    expect(source).toContain('hsl(var(--agent-avatar-surface-attention))');
    expect(source).toContain('hsl(var(--agent-avatar-surface-active))');
    expect(source).not.toContain('agent-avatar-with-state--unread');
    expect(source).toContain('hsl(var(--agent-avatar-surface-waiting))');
    expect(avatarSource).toContain('hsl(var(--agent-avatar-surface-neutral))');
    expect(avatarSource).toContain('background-color: var(');
    expect(avatarSource).toContain('color: #080808');
    expect(avatarSource).toContain(':global([data-agent-avatar-with-state]) .agent-avatar');
    expect(avatarSource).toMatch(/data-agent-avatar-with-state[^}]*color: inherit/);
    expect(avatarSource).toContain('--agent-avatar-background-forced, Canvas');
    expect(avatarSource).toContain('opacity: 1');
    expect(source).toContain('--agent-avatar-background-forced: Highlight');
    expect(source).toContain('--agent-avatar-background-forced: Field');
    expect(source).toContain('--agent-avatar-background-forced: Mark');
    expect(source).toContain('color: #080808');
    expect(source.match(/^\s+color:/gm)).toHaveLength(4);
    expect(source).toMatch(/transition: background-color/);
    expect(source).toContain('@media (forced-colors: active)');
    expect(source).toMatch(/forced-colors: active[\s\S]*outline: 1px solid CanvasText/);
    expect(source).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none/);
    for (const family of ['neutral', 'attention', 'failed', 'active', 'waiting']) {
      expect(tokenSource).toContain(`--theme-light-agent-avatar-surface-${family}:`);
      expect(tokenSource).toContain(`--theme-dark-agent-avatar-surface-${family}:`);
      expect(tokenSource).toContain(`--agent-avatar-surface-${family}:`);
    }
    for (const role of ['surface-completed', 'foreground-completed']) {
      expect(tokenSource).toContain(`--theme-light-agent-avatar-${role}:`);
      expect(tokenSource).toContain(`--theme-dark-agent-avatar-${role}:`);
      expect(tokenSource).toContain(`--agent-avatar-${role}:`);
    }
    for (const variant of ['compact', 'standard', 'emphasized', 'prominent']) {
      for (const property of [
        'surface-size',
        'art-size',
        'clear-space',
        'corner-radius',
        'ring-width',
        'stack-overlap',
      ]) {
        expect(tokenSource).toContain(`--agent-avatar-${variant}-${property}:`);
      }
    }
  });

  it('keeps the waiting surface calm, accessible, and separate in both themes', () => {
    expect(source).toMatch(
      /agent-avatar-with-state--waiting[\s\S]*hsl\(var\(--agent-avatar-surface-waiting\)\)/,
    );
    expect(source).toMatch(/forced-colors: active[\s\S]*--waiting[\s\S]*background-color: Field/);
    for (const theme of ['light', 'dark'] as const) {
      const waiting = waitingSurfaceByTheme[theme];
      expect(tokenSource).toContain(
        `--theme-${theme}-agent-avatar-surface-waiting: ${waiting.channels};`,
      );
      expect(contrastWithReferenceGlyph(waiting.rgb)).toBeGreaterThanOrEqual(3);
      for (const other of otherSurfaceRgbByTheme[theme]) {
        expect(colorDistance(waiting.rgb, other)).toBeGreaterThan(60);
      }
    }
  });

  it('keeps unread agents neutral while the workspace unread status stays blue', () => {
    expect(source).not.toContain('--agent-avatar-surface-unread');
    expect(getAgentAvatarStateLabel('unread')).toMatch(/unread/i);
    for (const theme of ['light', 'dark'] as const) {
      const unread = workspaceUnreadSurfaceByTheme[theme];
      expect(tokenSource).toContain(
        `--theme-${theme}-workspace-status-unread: ${unread.channels};`,
      );
      expect(unread.rgb[2] - unread.rgb[0]).toBeGreaterThan(100);
      expect(contrastWithReferenceGlyph(unread.rgb)).toBeGreaterThanOrEqual(3);
    }
  });

  it('reacts from idle through waiting-for-agent and running to settled without remount', async () => {
    const props = {
      agentId: 'reactive-agent',
      specialist: 'implementor',
      state: 'idle' as AvatarState,
      variant: 'standard' as const,
    };
    const view = render(AgentAvatarWithState, { props });
    const mountedAvatar = view.container.querySelector('[data-agent-avatar-with-state]');
    const mountedSvg = view.container.querySelector('svg');

    for (const state of ['waiting', 'running', 'completed'] as const) {
      await view.rerender({ ...props, state });
      const avatar = view.container.querySelector('[data-agent-avatar-with-state]');
      expect(avatar).toBe(mountedAvatar);
      expect(view.container.querySelector('svg')).toBe(mountedSvg);
      expect(avatar?.getAttribute('data-avatar-state')).toBe(state);
      expect(avatar?.getAttribute('aria-label')).toBe(getAgentAvatarStateLabel(state));
      expect(avatar?.className).toContain(`agent-avatar-with-state--${state}`);
    }
  });

  it('defines the named geometry contract and uses it in owned consumers', () => {
    expect(agentAvatarGeometry.standard.surface).toBe(20);
    expect(agentAvatarGeometry.emphasized.surface).toBe(24);
    expect(agentAvatarGeometry['card-stack']).toEqual(agentAvatarGeometry.emphasized);
    expect(agentAvatarGeometry.prominent.surface).toBe(40);
    expect(agentAvatarGeometry.compact.surface).toBe(16);
    for (const variant of agentAvatarVariants) {
      const geometry = agentAvatarGeometry[variant];
      expect(geometry.surface - geometry.art).toBe(geometry.clearSpace * 2);
      expect(geometry.overlap).toBeLessThanOrEqual(geometry.surface / 4);
      expect(geometry.radius).toBeLessThan(geometry.surface / 2);
    }
    expect(catalogSource).not.toMatch(/<AgentAvatarWithState[\s\S]{0,180}\bsize=/);
    expect(tabSource).not.toMatch(/<AgentAvatarWithState[\s\S]{0,180}\bsize=/);
    expect(catalogSource).toContain('<AgentAvatarStack');
    expect(tabSource).toContain('<AgentAvatarStack');
    expect(tabSource).toContain('variant="emphasized"');
    expect(tabSource).toContain('overflowId=');
  });

  it('uses the card-stack rounded-square silhouette for every overlap layer', () => {
    expect(stackSource).toContain('border-radius: var(--agent-avatar-corner-radius)');
    expect(stackSource).toContain("viewBox='0 0 24 24'");
    expect(stackSource).toContain("x='17' y='-1' width='26' height='26'");
    expect(stackSource).toContain("rx='8'");
    expect(stackSource).toContain('mask-size: 100% 100%');
    expect(stackSource).not.toContain('radial-gradient');
  });

  it('keeps the authoritative state precedence unchanged', () => {
    const cases: Array<
      [AvatarState, Parameters<typeof getAvatarState>[0], Parameters<typeof getAvatarState>[1]]
    > = [
      ['completed', { status: AgentStatus.Idle }, { isCompleted: true, isFailed: true }],
      ['running', { status: AgentStatus.Processing }, { isCompleted: true }],
      ['failed', { isStreaming: true }, { isFailed: true, hasPermissionRequest: true }],
      [
        'needs-permission',
        { isStreaming: true },
        { hasPermissionRequest: true, attentionKind: 'discussion' },
      ],
      ['attention-discussion', { isStreaming: true }, { attentionKind: 'discussion' }],
      ['attention-blocker', { status: AgentStatus.Waiting }, { attentionKind: 'blocker' }],
      ['running', { isStreaming: true, status: AgentStatus.Waiting }, { hasUnread: true }],
      ['waiting', { status: AgentStatus.Waiting }, { hasUnread: true }],
      ['unread', { status: AgentStatus.Idle }, { hasUnread: true, isActive: false }],
      ['idle', { status: AgentStatus.Idle }, { hasUnread: true, isActive: true }],
    ];
    for (const [expected, input, options] of cases) {
      expect(getAvatarState(input, options)).toBe(expected);
    }
  });

  it('renders the compact catalog as every design across every state', async () => {
    const Catalog = (await import('./AgentAvatarCatalog.svelte')).default;
    const { container } = render(Catalog);
    expect(container.querySelectorAll('[data-catalog-avatar-design]')).toHaveLength(
      agentAvatarCatalogIdentities.length,
    );
    expect(
      container.querySelectorAll('.agent-avatar-catalog-states [data-agent-avatar-with-state]'),
    ).toHaveLength(agentAvatarCatalogIdentities.length * agentAvatarCatalogStates.length);
    expect(
      container.querySelectorAll('[data-agent-avatar-catalog-variants] [data-avatar-variant]'),
    ).toHaveLength(agentAvatarVariants.length * 2);
    expect(
      container.querySelectorAll(
        '[data-agent-avatar-catalog-stack] [data-agent-avatar-with-state]',
      ),
    ).toHaveLength(3);
  });
});
