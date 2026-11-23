import { afterEach, describe, expect, it } from 'vitest';
import { adjacentLightboxOpener } from '../lightbox-gallery';

const PNG = 'data:image/png;base64,AAAA';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('adjacentLightboxOpener', () => {
  it('walks chat openers and bare markdown images in document order', () => {
    mount(`
      <div data-lightbox-gallery>
        <button id="attachment" data-lightbox-opener></button>
        <div class="markdown-content">
          <img id="markdown" src="${PNG}" />
          <a href="https://example.com"><img id="linked" src="${PNG}" /></a>
          <img id="unsupported" src="http://example.com/a.png" />
        </div>
        <button id="disabled" data-lightbox-opener disabled></button>
        <button id="tool" data-lightbox-opener><img id="inner" src="${PNG}" /></button>
      </div>
    `);

    expect(adjacentLightboxOpener(byId('attachment'), 1)).toBe(byId('markdown'));
    expect(adjacentLightboxOpener(byId('markdown'), 1)).toBe(byId('tool'));
    expect(adjacentLightboxOpener(byId('tool'), -1)).toBe(byId('markdown'));
  });

  it('stops at either end of the gallery', () => {
    mount(`
      <div data-lightbox-gallery>
        <button id="first" data-lightbox-opener></button>
        <button id="last" data-lightbox-opener></button>
      </div>
    `);

    expect(adjacentLightboxOpener(byId('first'), -1)).toBeNull();
    expect(adjacentLightboxOpener(byId('last'), 1)).toBeNull();
  });

  it('does not navigate from an opener outside a gallery', () => {
    mount(`
      <button id="alone" data-lightbox-opener></button>
      <button id="other" data-lightbox-opener></button>
    `);

    expect(adjacentLightboxOpener(byId('alone'), 1)).toBeNull();
    expect(adjacentLightboxOpener(null, 1)).toBeNull();
  });
});
