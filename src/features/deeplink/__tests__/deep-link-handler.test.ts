import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Routing tests for DeepLinkHandler's pair-link handling: `intent://pair`
 * links go to the main-process pair handler (never the renderer via IPC),
 * park as pending on cold start, and their bearer token never reaches a log
 * line. Non-pair links keep the existing renderer `deep-link` IPC behavior.
 */

const handlePairDeepLink = vi.fn();
vi.mock('../main/pair-deep-link', () => ({
  get handlePairDeepLink() {
    return handlePairDeepLink;
  },
}));

const logLines: string[] = [];
vi.mock('../../../shared/logger', () => ({
  Logger: class {
    debug(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    info(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    warn(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    error(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
  },
}));

import type { BrowserWindow } from 'electron';
import { DeepLinkHandler } from '../deep-link-handler';
import { scrubToken } from '../utils/scrub-token';
import { TC_ADDRESS_WITH_PSK } from '../../../test/fixtures/tc-address.fixture';

const TOKEN = 'super-secret-token-value';
const PAIR_LINK = `intent://pair?v=1&host=192.168.1.10&port=8443&fp=AA:BB:CC&token=${TOKEN}&tc=${TC_ADDRESS_WITH_PSK}`;

function makeWindow() {
  return {
    webContents: { send: vi.fn() },
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
  };
}

function asBrowserWindow(win: ReturnType<typeof makeWindow>): BrowserWindow {
  return win as unknown as BrowserWindow;
}

beforeEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
  handlePairDeepLink.mockResolvedValue(undefined);
});

describe('DeepLinkHandler pair-link routing', () => {
  it('routes a pair link to the main-process handler, never the renderer', async () => {
    const handler = new DeepLinkHandler();
    const win = makeWindow();
    await handler.handleDeepLink(PAIR_LINK, asBrowserWindow(win));
    expect(handlePairDeepLink).toHaveBeenCalledWith(PAIR_LINK);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('parks a pair link on cold start and routes it on processPendingUrl', async () => {
    const handler = new DeepLinkHandler();
    await handler.handleDeepLink(PAIR_LINK, null);
    expect(handlePairDeepLink).not.toHaveBeenCalled();

    const win = makeWindow();
    await handler.processPendingUrl(asBrowserWindow(win));
    expect(handlePairDeepLink).toHaveBeenCalledTimes(1);
    expect(handlePairDeepLink).toHaveBeenCalledWith(PAIR_LINK);
    expect(win.webContents.send).not.toHaveBeenCalled();

    // The pending slot is consumed: a second pass does nothing.
    handlePairDeepLink.mockClear();
    await handler.processPendingUrl(asBrowserWindow(win));
    expect(handlePairDeepLink).not.toHaveBeenCalled();
  });

  it('still sends non-pair links to the renderer as before', async () => {
    const handler = new DeepLinkHandler();
    const win = makeWindow();
    await handler.handleDeepLink('intent://open?id=workspace_123', asBrowserWindow(win));
    expect(win.webContents.send).toHaveBeenCalledWith('deep-link', {
      type: 'open',
      params: { id: 'workspace_123' },
    });
    expect(handlePairDeepLink).not.toHaveBeenCalled();
  });

  it('never logs pairing credentials across park, process, and parse paths', async () => {
    const handler = new DeepLinkHandler();
    await handler.handleDeepLink(PAIR_LINK, null);
    await handler.processPendingUrl(asBrowserWindow(makeWindow()));
    handler.parseDeepLink(PAIR_LINK);
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(TOKEN);
    expect(allLogs).not.toContain(TC_ADDRESS_WITH_PSK);
  });

  it('does not log the raw URL input carried by a parsing exception', () => {
    const handler = new DeepLinkHandler();
    expect(handler.parseDeepLink(`intent://pair:invalid?tc=${TC_ADDRESS_WITH_PSK}`)).toBeNull();
    expect(logLines.join('\n')).not.toContain(TC_ADDRESS_WITH_PSK);
  });
});

describe('pairing diagnostic scrubbing', () => {
  it.each([
    PAIR_LINK,
    PAIR_LINK.replace('intent://pair', 'INTENT://PAIR'),
    `intent://pair?%74oken=${TOKEN}&%74c=${TC_ADDRESS_WITH_PSK}`,
    `intent://pair?host=${TC_ADDRESS_WITH_PSK}&token=${TOKEN}`,
  ])('redacts complete pairing links in free-form text', (link) => {
    const scrubbed = scrubToken(`failed for "${link}"; retry later`);
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).not.toContain(TC_ADDRESS_WITH_PSK);
    expect(scrubbed).toContain('retry later');
  });

  it('retains standalone token protection and redacts tc query fields', () => {
    const scrubbed = scrubToken(`token=${TOKEN}&tc=${TC_ADDRESS_WITH_PSK} retry later`);
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).not.toContain(TC_ADDRESS_WITH_PSK);
    expect(scrubbed).toContain('token=REDACTED');
    expect(scrubToken('intent://settings?section=general')).toBe(
      'intent://settings?section=general',
    );
  });

  it('redacts a bare Tailcat address echoed by an error', () => {
    expect(scrubToken(`Connection to ${TC_ADDRESS_WITH_PSK} failed`)).not.toContain(
      TC_ADDRESS_WITH_PSK,
    );
  });
});
