import { describe, expect, it } from 'vitest';
import { browserElementPayloadSchema } from './element-picker-payload';

const validPayload = {
  selector: '#save',
  domPath: 'html>body>button#save.primary',
  tagName: 'button',
  id: 'save',
  className: 'primary',
  textSnippet: 'Save changes',
  rect: { x: -4, y: 20, width: 100, height: 40 },
  pageUrl: 'https://example.com/settings',
  sourceRef: 'src/routes/settings/+page.svelte:42:2',
};

describe('browserElementPayloadSchema', () => {
  it('accepts the picker payload contract', () => {
    expect(browserElementPayloadSchema.parse(validPayload)).toEqual(validPayload);
  });

  it.each([
    { ...validPayload, selector: '' },
    { ...validPayload, textSnippet: 'x'.repeat(121) },
    { ...validPayload, rect: { ...validPayload.rect, width: -1 } },
    { ...validPayload, rect: { ...validPayload.rect, x: Number.NaN } },
    { ...validPayload, unexpected: true },
  ])('rejects malformed picker payloads', (payload) => {
    expect(browserElementPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
