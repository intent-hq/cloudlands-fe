import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/components/chat/AgentCard.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockAgentCard.svelte')).default,
}));

import LazyAgentCard from '../LazyAgentCard.svelte';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private elements = new Set<Element>();

  constructor(private callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  fire(isIntersecting: boolean) {
    this.callback(
      [...this.elements].map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

describe('LazyAgentCard', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mounts the heavy agent card only while it is near the viewport', async () => {
    const { container } = render(LazyAgentCard, {
      props: { cacheKey: 'agent-1', agentId: 'agent-1', agentName: 'Worker' },
    });

    expect(screen.queryByTestId('mock-agent-card')).toBeNull();
    const placeholder = container.querySelector<HTMLElement>('[data-lazy-agent-card]');
    expect(placeholder?.style.height).toBe('40px');

    MockIntersectionObserver.instances[0]?.fire(true);
    expect((await screen.findByTestId('mock-agent-card')).getAttribute('data-agent-id')).toBe(
      'agent-1',
    );

    MockIntersectionObserver.instances[0]?.fire(false);
    await vi.waitFor(() => expect(screen.queryByTestId('mock-agent-card')).toBeNull());
  });
});
