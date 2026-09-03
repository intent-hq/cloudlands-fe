import type { BrowserElementCapture } from '$store/renderer/slices/browser/browser-types';
import type { ContextItem } from './input/context-api';

function captureHost(capture: BrowserElementCapture): string {
  try {
    return new URL(capture.pageUrl).hostname || capture.pageUrl;
  } catch {
    return capture.pageUrl;
  }
}

export function browserCaptureTargetsAgent(
  capture: BrowserElementCapture,
  agentId: string,
): boolean {
  return capture.targetAgentId === agentId;
}

export function browserCaptureToContextItems(
  capture: BrowserElementCapture,
): [image: ContextItem, context: ContextItem] {
  const element = capture.element;
  const viewport = (
    capture as BrowserElementCapture & { viewport?: { width: number; height: number } }
  ).viewport;
  const host = captureHost(capture);
  const label = element ? `<${element.tagName.toLowerCase()}> · ${host}` : capture.title || host;
  const details = [
    '<browser-element-capture>',
    // i18n-ignore (structured agent context, not user-facing UI)
    `Page URL: ${capture.pageUrl}`,
    // i18n-ignore (structured agent context, not user-facing UI)
    `Page title: ${capture.title}`,
    ...(element
      ? [
          `DOM path: ${element.domPath}`,
          `CSS selector: ${element.selector}`,
          // i18n-ignore (structured agent context, not user-facing UI)
          `Text snippet: ${element.textSnippet}`,
          // i18n-ignore (structured agent context, not user-facing UI)
          ...(element.sourceRef ? [`Source ref: ${element.sourceRef}`] : []),
          ...(viewport ? [`Viewport: ${viewport.width}×${viewport.height}`] : []),
          // i18n-ignore (structured agent context, not user-facing UI)
          `Element bounds: ${element.rect.width}×${element.rect.height} at (${element.rect.x}, ${element.rect.y})`,
        ]
      : []),
    '</browser-element-capture>',
  ].join('\n');

  return [
    {
      id: `${capture.id}-image`,
      type: 'file',
      label,
      imageData: capture.image.data,
      imageMimeType: capture.image.mimeType,
    },
    {
      id: `${capture.id}-context`,
      type: 'selection',
      label,
      content: details,
    },
  ];
}

export function appendContextItemContent(base: string, items: ContextItem[]): string {
  const itemContent = items
    .filter((item) => item.type === 'selection')
    .flatMap((item) => (item.content?.trim() ? [item.content.trim()] : []));
  return [base.trim(), ...itemContent].filter(Boolean).join('\n');
}
