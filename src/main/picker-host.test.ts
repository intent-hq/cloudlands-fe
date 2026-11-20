import { describe, expect, it } from 'vitest';

import { resolvePickerHost, type PickerHostGraph } from './picker-host';

interface Page {
  name: string;
  host?: boolean;
  embedder?: Page;
  opener?: Page;
  shown?: Page;
}

const graph: PickerHostGraph<Page> = {
  isHost: (p) => p.host === true,
  embedderOf: (p) => p.embedder,
  openerOf: (p) => p.opener,
  shownRendererOf: (p) => p.shown,
};

describe('resolvePickerHost', () => {
  const app: Page = { name: 'app renderer', host: true };
  const tab: Page = { name: 'webview guest', embedder: app };

  it('uses an app renderer directly', () => {
    expect(resolvePickerHost(app, graph)).toBe(app);
  });

  it('walks a browser tab to its embedder', () => {
    expect(resolvePickerHost(tab, graph)).toBe(app);
  });

  it('walks a website popup through its opener tab to the app renderer', () => {
    const popup: Page = { name: 'popup window', opener: tab, shown: undefined };
    // The popup's own window shows the website itself: never a host.
    popup.shown = popup;
    expect(resolvePickerHost(popup, graph)).toBe(app);
  });

  it('walks a popup opened by a popup', () => {
    const first: Page = { name: 'popup 1', opener: tab };
    const second: Page = { name: 'popup 2', opener: first };
    expect(resolvePickerHost(second, graph)).toBe(app);
  });

  it('cancels (null) for a popup whose opener is gone', () => {
    const orphan: Page = { name: 'orphan popup' };
    orphan.shown = orphan;
    expect(resolvePickerHost(orphan, graph)).toBeNull();
  });

  it("uses the app renderer a main-owned view's window shows", () => {
    const view: Page = { name: 'main-owned view', shown: app };
    expect(resolvePickerHost(view, graph)).toBe(app);
  });

  it('cancels when the window shows a renderer that cannot host the picker', () => {
    const view: Page = { name: 'view', shown: { name: 'not ready' } };
    expect(resolvePickerHost(view, graph)).toBeNull();
  });

  it('stops on an opener cycle', () => {
    const a: Page = { name: 'a' };
    const b: Page = { name: 'b', opener: a };
    a.opener = b;
    expect(resolvePickerHost(a, graph)).toBeNull();
  });

  it('cancels with no page at all', () => {
    expect(resolvePickerHost(undefined, graph)).toBeNull();
  });
});
