import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ContextProviderIcon from '$features/context/components/ContextProviderIcon.svelte';
import AgentProviderIcon from '$features/agent/components/AgentProviderIcon.svelte';

afterEach(() => cleanup());

describe('domain provider icon contracts', () => {
  it('renders an ACP agent-provider icon from providerId', () => {
    const { container } = render(AgentProviderIcon, {
      props: { providerId: 'codex', class: 'agent-provider', size: 20 },
    });

    const icon = container.querySelector('svg[role="img"]');
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains('agent-provider')).toBe(true);
    expect(icon?.getAttribute('width')).toBe('20');
    expect(icon?.getAttribute('height')).toBe('20');
  });

  it('renders a context-provider icon from the context provider contract', () => {
    const { container } = render(ContextProviderIcon, {
      props: { provider: 'github', class: 'context-provider', size: 18 },
    });

    const icon = container.querySelector('svg[viewBox="0 0 24 24"]');
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains('context-provider')).toBe(true);
    expect(icon?.getAttribute('width')).toBe('18');
    expect(icon?.getAttribute('height')).toBe('18');
  });
});
