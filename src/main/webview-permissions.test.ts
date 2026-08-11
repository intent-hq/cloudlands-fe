import { describe, expect, it } from 'vitest';
import {
  isBrowserPanelPermissionAllowed,
  isDefaultSessionPermissionAllowed,
} from './webview-security';

describe('webview permission boundaries', () => {
  it('allows app clipboard access only from trusted renderer origins', () => {
    expect(isDefaultSessionPermissionAllowed('clipboard-read', 'app://workspaces/index.html')).toBe(
      true,
    );
    expect(isDefaultSessionPermissionAllowed('clipboard-read', 'https://example.com')).toBe(false);
    expect(isDefaultSessionPermissionAllowed('geolocation', 'app://workspaces/index.html')).toBe(false);
  });

  it('never grants clipboard read to arbitrary embedded websites', () => {
    expect(isBrowserPanelPermissionAllowed('clipboard-read')).toBe(false);
    expect(isBrowserPanelPermissionAllowed('clipboard-sanitized-write')).toBe(true);
    expect(isBrowserPanelPermissionAllowed('storage-access')).toBe(true);
  });
});