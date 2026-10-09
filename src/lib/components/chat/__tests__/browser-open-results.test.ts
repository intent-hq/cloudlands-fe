import { describe, expect, it } from 'vitest';
import { encode } from '@toon-format/toon';
import { parseToolResult } from '../tool-result-parser';

describe('browser open activity', () => {
  const opened = { success: true, tabId: 'tab-docs', url: 'https://svelte.dev/docs' };

  it('reads the single-action envelope returned by the daemon', () => {
    const result = parseToolResult(
      'workspace_api',
      { code: 'return await ws.browser.exec(actions)' },
      encode({ action: 'openTab', success: true, result: opened }),
    );
    expect(result.browserOpenedTabs).toEqual([
      { tabId: 'tab-docs', url: 'https://svelte.dev/docs' },
    ]);
  });

  it.each([JSON.stringify, encode])('reads an unwrapped workspace API open result', (serialize) => {
    const result = parseToolResult(
      'workspace_api',
      { code: 'return await ws.browser.exec([{ action: "openTab", url }])' },
      [{ type: 'text', text: serialize(opened) }],
    );
    expect(result.browserOpenedTabs).toEqual([
      { tabId: 'tab-docs', url: 'https://svelte.dev/docs' },
    ]);
  });

  it('pairs a direct browser open response and retains its requested tunnel URL', () => {
    const result = parseToolResult(
      'browser_exec',
      { actions: [{ action: 'openTab', url: 'http://daemon.localhost:5173' }] },
      JSON.stringify({
        ...opened,
        requestedUrl: 'http://daemon.localhost:5173',
        url: 'http://127.0.0.1:43111/',
        finalUrl: 'http://127.0.0.1:43111/',
        rewritten: true,
      }),
    );
    expect(result.browserOpenedTabs).toEqual([
      { tabId: 'tab-docs', url: 'http://daemon.localhost:5173' },
    ]);
  });

  it('keeps successful opens in a mixed failed batch and removes duplicate tab badges', () => {
    const result = parseToolResult(
      'workspace_api',
      { code: 'await ws.note.read("spec"); return await ws.browser.exec(actions)' },
      encode([
        { action: 'openTab', success: true, result: opened },
        { action: 'openTab', success: true, result: { ...opened, reused: true } },
        { action: 'openTab', success: false, error: 'Could not mount', result: opened },
        { action: 'navigate', success: true, result: { tabId: 'navigation', url: opened.url } },
      ]),
    );
    expect(result.browserOpenedTabs).toEqual([
      { tabId: 'tab-docs', url: 'https://svelte.dev/docs' },
    ]);
  });

  it('retains the successful open when the execution envelope reports a later action failure', () => {
    const result = parseToolResult(
      'browser_exec',
      {
        actions: [
          { action: 'openTab', url: opened.url },
          { action: 'evaluate', expression: 'bad' },
        ],
      },
      JSON.stringify({
        success: false,
        results: [
          { action: 'openTab', success: true, result: opened },
          { action: 'evaluate', success: false, error: 'failed' },
        ],
      }),
    );
    expect(result.browserOpenedTabs).toEqual([
      { tabId: 'tab-docs', url: 'https://svelte.dev/docs' },
    ]);
  });

  it.each([
    { success: false, tabId: 'bad', url: opened.url },
    { success: true, url: opened.url },
    { success: true, tabId: 'bad' },
    { tabId: 'navigate-only', url: opened.url },
  ])('does not create a badge without a confirmed open and destination', (payload) => {
    expect(
      parseToolResult(
        'browser_exec',
        { actions: [{ action: 'openTab', url: opened.url }] },
        JSON.stringify(payload),
      ).browserOpenedTabs,
    ).toBeUndefined();
  });

  it('does not mistake listTabs or evaluate output for an open', () => {
    for (const action of ['listTabs', 'evaluate']) {
      expect(
        parseToolResult('browser_exec', { actions: [{ action }] }, JSON.stringify([opened]))
          .browserOpenedTabs,
      ).toBeUndefined();
    }
  });
});
