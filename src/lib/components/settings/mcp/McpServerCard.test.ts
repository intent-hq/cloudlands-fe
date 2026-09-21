/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import McpServerCard from './McpServerCard.svelte';

const handlers = () => ({
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onReauthenticate: vi.fn(),
  onRestart: vi.fn(),
});

afterEach(cleanup);

describe('McpServerCard recovery actions', () => {
  it('routes an auth-required server to interactive reauthentication', async () => {
    const callbacks = handlers();
    render(McpServerCard, {
      props: {
        server: {
          id: 'srv-figma',
          name: 'figma',
          type: 'http',
          url: 'https://mcp.figma.com/mcp',
          authType: 'oauth',
          status: 'auth_required',
          errorMessage: 'Authentication expired',
          tools: [],
          toolCount: 0,
        },
        ...callbacks,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    expect(callbacks.onReauthenticate).toHaveBeenCalledExactlyOnceWith('figma');
    expect(callbacks.onRestart).not.toHaveBeenCalled();
    expect(screen.getByText('Authentication expired')).toBeTruthy();
  });

  it('routes a stopped server to restart instead of authentication', async () => {
    const callbacks = handlers();
    render(McpServerCard, {
      props: {
        server: {
          id: 'srv-desktop',
          name: 'figma-desktop',
          type: 'http',
          url: 'http://127.0.0.1:3845/mcp',
          status: 'stopped',
          tools: [],
          toolCount: 0,
        },
        ...callbacks,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

    expect(callbacks.onRestart).toHaveBeenCalledExactlyOnceWith('figma-desktop');
    expect(callbacks.onReauthenticate).not.toHaveBeenCalled();
  });
});
