import { cleanup, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import AgentAvatar from './AgentAvatar.svelte';
import { agentAvatarCatalogIdentities } from './agent-avatar.catalog';
import { getAgentAvatarDesign } from './avatar-design';
import { agentAvatarGeometry, agentAvatarVariants } from './avatar-size';

const avatarSource = readFileSync(
  resolve(process.cwd(), 'src/features/agent/components/agent-avatar/AgentAvatar.svelte'),
  'utf8',
);
const artSource = readFileSync(
  resolve(process.cwd(), 'src/features/agent/components/agent-avatar/AgentAvatarArt.svelte'),
  'utf8',
);

afterEach(cleanup);

describe('AgentAvatar', () => {
  it.each(agentAvatarCatalogIdentities)(
    'renders $design in one currentColor art box',
    (identity) => {
      const { container } = render(AgentAvatar, {
        props: {
          agentId: identity.agentId,
          specialist: identity.specialist,
          variant: 'standard',
        },
      });
      const svg = container.querySelector('svg');

      expect(svg?.getAttribute('data-avatar-design')).toBe(identity.design);
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.getAttribute('height')).toBe('20');
      expect(svg?.getAttribute('data-avatar-variant')).toBe('standard');
      expect(svg?.getAttribute('overflow')).toBe('hidden');
      expect(
        svg?.querySelector('[stroke="#080808"], [stroke="black"], [fill="#080808"]'),
      ).toBeNull();
      expect(svg?.querySelector('[stroke="currentColor"], [fill="currentColor"]')).not.toBeNull();
      const owner = svg?.querySelector('g[stroke="currentColor"]');
      expect(owner?.getAttribute('stroke-linecap')).toBe('butt');
      expect(owner?.getAttribute('stroke-linejoin')).toBe('miter');
    },
  );

  it.each(agentAvatarVariants)('maps %s to its named square geometry', (variant) => {
    const { container } = render(AgentAvatar, {
      props: { agentId: 'sized-agent', specialist: 'implementor', variant },
    });
    const svg = container.querySelector('svg');
    expect([svg?.getAttribute('width'), svg?.getAttribute('height')]).toEqual([
      String(agentAvatarGeometry[variant].surface),
      String(agentAvatarGeometry[variant].surface),
    ]);
    expect(svg?.getAttribute('data-avatar-variant')).toBe(variant);
    expect(agentAvatarGeometry[variant].surface - agentAvatarGeometry[variant].art).toBe(
      agentAvatarGeometry[variant].clearSpace * 2,
    );
  });

  it('keeps numeric sizing as a temporary migration fallback', () => {
    const { container } = render(AgentAvatar, {
      props: { agentId: 'legacy-sized-agent', size: 18 },
    });
    const svg = container.querySelector('svg');
    expect([svg?.getAttribute('width'), svg?.getAttribute('height')]).toEqual(['18', '18']);
    expect(svg?.hasAttribute('data-avatar-variant')).toBe(false);
    expect(avatarSource).toContain('.agent-avatar--legacy {\n    padding: 1px;');
  });

  it('owns sharp stroke geometry without child overrides', () => {
    expect(avatarSource).toContain('stroke-linecap="butt"');
    expect(avatarSource).toContain('stroke-linejoin="miter"');
    expect(`${avatarSource}\n${artSource}`).not.toMatch(/stroke-line(?:cap|join)=["']round["']/);
  });

  it('replaces provider logos with the same seeded vector identity', () => {
    const first = render(AgentAvatar, {
      props: { agentId: 'provider-agent', provider: 'codex' },
    });
    const firstDesign = first.container.querySelector('svg')?.getAttribute('data-avatar-design');
    expect(first.container.querySelector('img, [data-provider-icon]')).toBeNull();
    first.unmount();

    render(AgentAvatar, { props: { agentId: 'provider-agent', provider: 'claude-code' } });
    expect(document.querySelector('svg')?.getAttribute('data-avatar-design')).toBe(firstDesign);
    expect(document.querySelector('img, [data-provider-icon]')).toBeNull();
  });

  it('keeps seeded designs stable when a virtualized row is reused', async () => {
    const view = render(AgentAvatar, { props: { agentId: 'virtual-agent-a' } });
    const design = () => view.container.querySelector('svg')?.getAttribute('data-avatar-design');

    expect(design()).toBe(getAgentAvatarDesign('virtual-agent-a'));
    await view.rerender({ agentId: 'virtual-agent-b' });
    expect(design()).toBe(getAgentAvatarDesign('virtual-agent-b'));
    await view.rerender({ agentId: 'virtual-agent-a' });
    expect(design()).toBe(getAgentAvatarDesign('virtual-agent-a'));
  });

  it('is decorative by default and supports a caller-localized accessible name', () => {
    const decorative = render(AgentAvatar, { props: { agentId: 'decorative-agent' } });
    expect(decorative.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    decorative.unmount();

    render(AgentAvatar, {
      props: { agentId: 'named-agent', ariaLabel: 'Localized agent identity' },
    });
    expect(screen.getByRole('img', { name: 'Localized agent identity' })).toBeTruthy();
    expect(screen.getByTitle('Localized agent identity')).toBeTruthy();
  });
});
