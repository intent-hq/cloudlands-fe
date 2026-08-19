/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';

import { getNavigationContext } from './panel-context';

function inPanelClick(init: MouseEventInit = {}) {
  const panel = document.createElement('div');
  panel.dataset.panelId = 'panel-source';
  const button = document.createElement('button');
  panel.appendChild(button);
  const event = new MouseEvent('click', init);
  Object.defineProperty(event, 'target', { value: button });
  return event;
}

describe('getNavigationContext', () => {
  it('keeps an unmodified in-panel click as source context only', () => {
    expect(getNavigationContext(inPanelClick())).toEqual({
      sourcePanelId: 'panel-source',
      openInAdjacentPanel: false,
    });
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])(
    'requests adjacent routing for a modifier click: %o',
    (modifier) => {
      expect(getNavigationContext(inPanelClick(modifier))).toEqual({
        sourcePanelId: 'panel-source',
        openInAdjacentPanel: true,
      });
    },
  );
});
