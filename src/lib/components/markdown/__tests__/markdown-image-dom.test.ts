// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  imageActionsHaveFocus,
  imageAtTarget,
  isActionableImage,
  sizedImageLabel,
} from '../markdown-image-dom';

afterEach(() => document.body.replaceChildren());

describe('Markdown image DOM helpers', () => {
  it('resolves direct images and image links but not arbitrary containers', () => {
    const image = document.createElement('img');
    const link = document.createElement('a');
    const container = document.createElement('div');
    link.append(image);
    container.append(link);
    expect(imageAtTarget(image)).toBe(image);
    expect(imageAtTarget(link)).toBe(image);
    expect(imageAtTarget(container)).toBeNull();
    expect(imageAtTarget(document.createElement('a'))).toBeNull();
    expect(imageAtTarget(null)).toBeNull();
  });

  it('uses the raw source rather than a browser-resolved relative URL for actions', () => {
    const image = document.createElement('img');
    expect(isActionableImage(image)).toBe(false);
    image.setAttribute('src', 'docs/diagram.png');
    expect(isActionableImage(image)).toBe(false);
    image.setAttribute('src', 'https://example.com/diagram.png');
    expect(isActionableImage(image)).toBe(true);
  });

  it('retains actions for image, link and overlay focus but not unrelated focus', () => {
    const image = document.createElement('img');
    image.tabIndex = 0;
    const link = document.createElement('a');
    link.href = 'https://example.com';
    link.append(image);
    const overlay = document.createElement('div');
    const trigger = document.createElement('button');
    const unrelated = document.createElement('button');
    overlay.append(trigger);
    document.body.append(link, overlay, unrelated);

    image.focus();
    expect(imageActionsHaveFocus(image, overlay)).toBe(true);
    link.focus();
    expect(imageActionsHaveFocus(image, overlay)).toBe(true);
    trigger.focus();
    expect(imageActionsHaveFocus(image, overlay)).toBe(true);
    unrelated.focus();
    expect(imageActionsHaveFocus(image, overlay)).toBe(false);
    expect(imageActionsHaveFocus(null, null)).toBe(false);
  });

  it.each([
    ['workspace-file://ws-1/docs/a%20b.png?v=1', 'docs/a b.png'],
    ['intent://local/file/docs/a%20b.png', 'docs/a b.png'],
    ['workspace-asset://asset-123?version=1#preview', 'asset-123'],
    ['docs/a%20b.png', 'docs/a b.png'],
    ['docs/%broken.png', 'docs/%broken.png'],
    ['https://example.com/image.png', 'Diagram'],
    ['//example.com/image.png', 'Diagram'],
    ['data:image/png;base64,aGVsbG8=', 'Diagram'],
    ['', 'Diagram'],
  ])('derives a loading label for %s', (source, expected) => {
    const image = document.createElement('img');
    image.setAttribute('src', source);
    image.alt = 'Diagram';
    expect(sizedImageLabel(image, 'ws-1')).toBe(expected);
  });

  it('omits the loading label when neither a local path nor alt text is available', () => {
    const image = document.createElement('img');
    image.src = 'https://example.com/image.png';
    expect(sizedImageLabel(image)).toBeUndefined();
  });
});
