import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import ResourceNotFound from '../ResourceNotFound.svelte';

afterEach(() => {
  cleanup();
});

describe('ResourceNotFound', () => {
  it('renders "<label> not found" title for kind not_found', () => {
    render(ResourceNotFound, {
      props: {
        kind: 'not_found' as const,
        resourceLabel: 'Workspace',
        resourceId: 'ws-missing-1',
        onGoHome: vi.fn(),
      },
    });

    expect(screen.getByRole('heading').textContent?.trim()).toBe('Workspace not found');
    expect(screen.getByText('ws-missing-1')).toBeTruthy();
  });

  it('renders "Failed to load <label>" title and detail for kind error', () => {
    render(ResourceNotFound, {
      props: {
        kind: 'error' as const,
        resourceLabel: 'Workspace',
        resourceId: 'ws-broken-1',
        detail: 'Failed to open space: Backend exploded',
        onGoHome: vi.fn(),
      },
    });

    expect(screen.getByRole('heading').textContent?.trim()).toBe('Failed to load workspace');
    expect(screen.getByText('ws-broken-1')).toBeTruthy();
    expect(screen.getByText('Failed to open space: Backend exploded')).toBeTruthy();
  });

  it('omits resource id and detail when not provided', () => {
    const { container } = render(ResourceNotFound, {
      props: {
        kind: 'not_found' as const,
        resourceLabel: 'Agent',
        onGoHome: vi.fn(),
      },
    });

    expect(screen.getByRole('heading').textContent?.trim()).toBe('Agent not found');
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('is reusable for other resource labels', () => {
    render(ResourceNotFound, {
      props: {
        kind: 'error' as const,
        resourceLabel: 'Note',
        onGoHome: vi.fn(),
      },
    });

    expect(screen.getByRole('heading').textContent?.trim()).toBe('Failed to load note');
  });

  it('renders as a polite status region with an h1 by default and a decorative icon', () => {
    const { container } = render(ResourceNotFound, {
      props: {
        kind: 'not_found' as const,
        resourceLabel: 'Workspace',
        onGoHome: vi.fn(),
      },
    });

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent?.trim()).toBe(
      'Workspace not found',
    );
    const iconWrapper = container.querySelector('[aria-hidden="true"]');
    expect(iconWrapper).toBeTruthy();
    expect(iconWrapper?.querySelector('svg')).toBeTruthy();
  });

  it('supports a configurable heading level', () => {
    render(ResourceNotFound, {
      props: {
        kind: 'not_found' as const,
        resourceLabel: 'Workspace',
        headingLevel: 2 as const,
        onGoHome: vi.fn(),
      },
    });

    expect(screen.getByRole('heading', { level: 2 }).textContent?.trim()).toBe(
      'Workspace not found',
    );
  });

  it('invokes the onGoHome callback when the Home button is clicked', async () => {
    const onGoHome = vi.fn();
    render(ResourceNotFound, {
      props: {
        kind: 'not_found' as const,
        resourceLabel: 'Workspace',
        resourceId: 'ws-missing-2',
        onGoHome,
      },
    });

    const button = screen.getByRole('button', { name: 'Go to Home' });
    await fireEvent.click(button);

    expect(onGoHome).toHaveBeenCalledTimes(1);
  });
});
