/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { isDiagramPresentationReady } from '../../test/diagram-presentation-readiness';

describe('browser diagram presentation readiness', () => {
  it('keeps standalone renderers eligible after their child readiness check', () => {
    const renderer = document.createElement('div');
    renderer.dataset.diagramSettled = 'true';
    expect(isDiagramPresentationReady(renderer)).toBe(true);
  });

  it('blocks a settled child until its own presentation is ready', () => {
    const wrapper = document.createElement('div');
    wrapper.dataset.diagramPresentation = '';
    wrapper.dataset.diagramPresentationSettled = 'false';
    const renderer = document.createElement('div');
    renderer.dataset.diagramSettled = 'true';
    wrapper.append(renderer);
    expect(isDiagramPresentationReady(renderer)).toBe(false);
    wrapper.dataset.diagramPresentationSettled = 'true';
    expect(isDiagramPresentationReady(renderer)).toBe(true);
    wrapper.dataset.diagramPresentationSettled = 'false';
    expect(isDiagramPresentationReady(renderer)).toBe(false);
  });

  it('does not use a ready outer presentation when the nearest one is pending', () => {
    const outer = document.createElement('div');
    outer.dataset.diagramPresentation = '';
    outer.dataset.diagramPresentationSettled = 'true';
    const inner = document.createElement('div');
    inner.dataset.diagramPresentation = '';
    const renderer = document.createElement('div');
    outer.append(inner);
    inner.append(renderer);
    expect(isDiagramPresentationReady(renderer)).toBe(false);
    inner.dataset.diagramPresentationSettled = 'true';
    expect(isDiagramPresentationReady(renderer)).toBe(true);
  });
});
