import { afterEach, describe, expect, it, vi } from 'vitest';

import { MACHINE_HIDDEN_ATTRIBUTE } from '$shared/types/machine-rail';
import { forwardToastWhenHidden } from './machine-toast-forward';

function installBridge() {
  const invoke = vi.fn(async () => ({ forwarded: true }));
  (window as unknown as { electronAPI?: unknown }).electronAPI = { invoke };
  return invoke;
}

describe('forwardToastWhenHidden', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.documentElement.removeAttribute(MACHINE_HIDDEN_ATTRIBUTE);
  });

  it('hands the toast to main when this machine is not the one shown', () => {
    const invoke = installBridge();
    document.documentElement.setAttribute(MACHINE_HIDDEN_ATTRIBUTE, '');
    forwardToastWhenHidden('warning', '  Agent needs you  ');
    expect(invoke).toHaveBeenCalledWith('machine-rail:forward-toast', {
      kind: 'warning',
      message: 'Agent needs you',
    });
  });

  it('sends nothing while this machine is shown', () => {
    const invoke = installBridge();
    forwardToastWhenHidden('error', 'Push failed');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty message and caps a long one at the wire limit', () => {
    const invoke = installBridge();
    document.documentElement.setAttribute(MACHINE_HIDDEN_ATTRIBUTE, '');
    forwardToastWhenHidden('info', '   ');
    expect(invoke).not.toHaveBeenCalled();
    forwardToastWhenHidden('info', 'x'.repeat(5000));
    const [, params] = invoke.mock.calls[0] as unknown as [string, { message: string }];
    expect(params.message).toHaveLength(2000);
  });

  it('does not throw outside the desktop app', () => {
    document.documentElement.setAttribute(MACHINE_HIDDEN_ATTRIBUTE, '');
    expect(() => forwardToastWhenHidden('success', 'Saved')).not.toThrow();
  });
});
