import { expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import type { JSONContent, Editor } from '@tiptap/core';
import type { DocumentSession } from './document-session';
export type Host = HTMLElement & {
  proof: DocumentSession;
  native: Editor;
  parseSource: (source: string) => Promise<{ html: string; doc: JSONContent }>;
};
async function state(page: Page, side: string) {
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native;
      return {
        doc: e!.getJSON(),
        selection: e!.state.selection.toJSON(),
        error: h.proof?.error ?? '',
      };
    });
}
export async function settled(page: Page) {
  // Input acknowledgement can precede selectionchange/paint. Agreement at that instant
  // may still be the previous selection; allow the browser to finish before polling.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        if (!selection?.anchorNode || !selection.focusNode) return true;
        for (const el of document.querySelectorAll('[data-testid="proof"]')) {
          const h = el as Host,
            e = h.proof?.editor ?? h.native;
          if (!e?.view.dom.contains(selection.anchorNode)) continue;
          return (
            e.state.selection.anchor ===
              e.view.posAtDOM(selection.anchorNode, selection.anchorOffset) &&
            e.state.selection.head === e.view.posAtDOM(selection.focusNode, selection.focusOffset)
          );
        }
        return true;
      }),
    )
    .toBe(true);
}
export async function focus(page: Page, side: string) {
  await settled(page);
  await expect.poll(() => page.getByTestId(side).locator('.tiptap').count()).toBe(1);
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(async (el) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native;
      // Native focus schedules selection recovery. Finish that lifecycle before
      // sending gestures so its callback cannot overwrite newer browser input.
      const timers = window as unknown as {
        setTimeout: (handler: TimerHandler, delay?: number, ...args: unknown[]) => number;
      };
      const originalTimeout = timers.setTimeout;
      const pending: Promise<void>[] = [];
      timers.setTimeout = (handler, delay, ...args) => {
        if (typeof handler !== 'function') return originalTimeout(handler, delay, ...args);
        let done!: () => void;
        pending.push(new Promise<void>((resolve) => (done = resolve)));
        return originalTimeout(() => {
          try {
            handler(...args);
          } finally {
            done();
          }
        }, delay);
      };
      try {
        e!.view.focus();
      } finally {
        timers.setTimeout = originalTimeout;
      }
      await Promise.all(pending);
    });
  await settled(page);
}
/** Plain-paragraph native offsets independently use text + real paragraph separators. */
export async function selectSource(page: Page, side: string, anchor: number, head = anchor) {
  await focus(page, side);
  const positions = await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, selection) => {
        const h = el as Host;
        if (h.proof)
          return {
            anchor: h.proof.projection!.pmAt(selection.anchor),
            head: h.proof.projection!.pmAt(selection.head),
          };
        const position = (source: number) => {
          let textOffset = 0,
            result = 1;
          h.native.state.doc.forEach((node, offset) => {
            if (source >= textOffset && source <= textOffset + node.textContent.length)
              result = offset + 1 + source - textOffset;
            textOffset += node.textContent.length + 2;
          });
          return result;
        };
        return { anchor: position(selection.anchor), head: position(selection.head) };
      },
      { anchor, head },
    );
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el, p) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native;
      e.commands.setTextSelection({ from: p.anchor, to: p.head });
    }, positions);
  await settled(page);
  expect(await logical(page, side)).toEqual({ anchor, head });
}
export async function logical(page: Page, side: string) {
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el) => {
      const h = el as Host;
      const e = h.proof?.editor ?? h.native;
      const selection = h.proof?.selection ?? {
        anchor: e.state.doc.textBetween(0, e.state.selection.anchor, '\n\n').length,
        head: e.state.doc.textBetween(0, e.state.selection.head, '\n\n').length,
      };
      return { anchor: selection.anchor, head: selection.head };
    });
}
export async function sameSaved(page: Page) {
  await settled(page);
  const native = await state(page, 'native');
  const saved = await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate(async (el) => {
      const h = el as Host;
      h.proof.save();
      return { parsed: await h.parseSource(h.proof.service.region(0)), error: h.proof.error };
    });
  expect(saved.error).toBe('');
  expect(
    JSON.stringify(saved.parsed.doc) === JSON.stringify(native.doc),
    'real parser and native document differ',
  ).toBe(true);
  expect(await logical(page, 'bounded')).toEqual(await logical(page, 'native'));
}
