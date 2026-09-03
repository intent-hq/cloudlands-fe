import { describe, expect, it } from 'vitest';
import type { BrowserElementCapture } from '$store/renderer/slices/browser/browser-types';
import {
  appendContextItemContent,
  browserCaptureTargetsAgent,
  browserCaptureToContextItems,
} from '../browser-capture-context';

const capture: BrowserElementCapture & { viewport: { width: number; height: number } } = {
  id: 'capture-1',
  tabId: 'browser-1',
  ownerAgentId: 'agent-owner',
  pageUrl: 'https://example.com/account',
  title: 'Account',
  image: { data: 'base64-png', mimeType: 'image/png' },
  viewport: { width: 1440, height: 900 },
  element: {
    selector: 'button#save',
    domPath: 'html > body > main > button#save',
    tagName: 'BUTTON',
    id: 'save',
    className: 'primary',
    textSnippet: 'Save changes',
    rect: { x: 80, y: 120, width: 140, height: 36 },
    pageUrl: 'https://example.com/account',
    sourceRef: 'src/routes/account.svelte:42:3',
  },
};

describe('browser capture chat context', () => {
  it('converts a capture into removable image and selection context items', () => {
    const [image, context] = browserCaptureToContextItems(capture);

    expect(image).toEqual({
      id: 'capture-1-image',
      type: 'file',
      label: '<button> · example.com',
      imageData: 'base64-png',
      imageMimeType: 'image/png',
    });
    expect(context).toMatchObject({
      id: 'capture-1-context',
      type: 'selection',
      label: '<button> · example.com',
    });
    expect(context.content).toContain('Page URL: https://example.com/account');
    expect(context.content).toContain('DOM path: html > body > main > button#save');
    expect(context.content).toContain('CSS selector: button#save');
    expect(context.content).toContain('Text snippet: Save changes');
    expect(context.content).toContain('Source ref: src/routes/account.svelte:42:3');
    expect(context.content).toContain('Viewport: 1440×900');
  });

  it('prefers the focused active agent chat and otherwise falls back to the tab owner', () => {
    expect(
      browserCaptureTargetsAgent(capture, 'agent-focused', {
        type: 'agent',
        agentId: 'agent-focused',
      }),
    ).toBe(true);
    expect(
      browserCaptureTargetsAgent(capture, 'agent-owner', {
        type: 'agent',
        agentId: 'agent-focused',
      }),
    ).toBe(false);
    expect(
      browserCaptureTargetsAgent(capture, 'agent-owner', { type: 'browser', agentId: undefined }),
    ).toBe(true);
  });

  it('folds only selection content into the message context string', () => {
    const [image, context] = browserCaptureToContextItems(capture);
    const result = appendContextItemContent('[Currently viewing: Spec]', [image, context]);

    expect(result).toBe(`[Currently viewing: Spec]\n${context.content}`);
  });
});
