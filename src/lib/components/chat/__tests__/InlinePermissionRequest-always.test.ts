import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import InlinePermissionRequest from '../InlinePermissionRequest.svelte';
import type { PermissionRequest } from '$store/renderer/slices/permission/permission-slice';
import { m } from '$shared/paraglide/messages.js';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function request(options: PermissionRequest['options']): PermissionRequest {
  return {
    requestId: 'r1',
    workspaceId: 'ws',
    sessionId: 'agent',
    title: 'Run command',
    options,
    timestamp: 0,
  };
}

const HINTS = {
  chat: () => m.chat_inlinePermission_alwaysScope_chat_hint(),
  workspace: () => m.chat_inlinePermission_alwaysScope_workspace_hint(),
  allWorkspaces: () => m.chat_inlinePermission_alwaysScope_allWorkspaces_hint(),
} as const;

describe('InlinePermissionRequest always-allow option', () => {
  it.each(Object.keys(HINTS) as Array<keyof typeof HINTS>)(
    'shows the %s reach under an allow_always option and no other hint',
    (scope) => {
      render(InlinePermissionRequest, {
        props: {
          request: request([
            { id: 'once', label: 'Yes', kind: 'allow_once' },
            { id: 'always', label: 'Always', kind: 'allow_always', scope },
            { id: 'no', label: 'No', kind: 'reject_once', destructive: true },
          ]),
        },
      });
      const always = screen.getByRole('button', { name: /Always/ });
      expect(always.textContent).toContain(HINTS[scope]());
      for (const other of Object.keys(HINTS) as Array<keyof typeof HINTS>) {
        if (other !== scope) expect(document.body.textContent).not.toContain(HINTS[other]());
      }
    },
  );

  it('shows an allow_always option without a hint when its reach is unknown', () => {
    render(InlinePermissionRequest, {
      props: { request: request([{ id: 'always', label: 'Always', kind: 'allow_always' }]) },
    });
    const always = screen.getByRole('button', { name: /Always/ });
    for (const hint of Object.values(HINTS)) expect(always.textContent).not.toContain(hint());
  });

  it('keeps hiding "always" options from daemons that send no option kind', () => {
    render(InlinePermissionRequest, {
      props: {
        request: request([
          { id: 'allow_once', label: 'Allow' },
          { id: 'allow_always', label: 'Always allow' },
          { id: 'reject_once', label: 'Deny', destructive: true },
        ]),
      },
    });
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Allow|Deny/ })).toHaveLength(2);
  });
});
