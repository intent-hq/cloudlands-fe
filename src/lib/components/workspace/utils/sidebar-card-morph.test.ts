import { beforeEach, describe, expect, it } from 'vitest';

import { applyContentReveal, contentRevealProgress } from './sidebar-card-morph';

function buildCard() {
  const root = document.createElement('div');
  root.setAttribute('data-sidebar-card-surface', '');
  const content = document.createElement('div');
  content.setAttribute('data-sidebar-expanded-content', '');
  root.appendChild(content);

  const list = document.createElement('ul');
  content.appendChild(list);
  const descendants: HTMLElement[] = [list];
  for (let index = 0; index < 5; index += 1) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `item ${index}`;
    row.appendChild(label);
    list.appendChild(row);
    descendants.push(row, label);
  }
  document.body.appendChild(root);

  return { root, content, descendants };
}

function inlineCustomProperties(element: HTMLElement): string[] {
  return Array.from({ length: element.style.length }, (_, index) =>
    element.style.item(index),
  ).filter((name) => name.startsWith('--'));
}

describe('contentRevealProgress', () => {
  it('holds the content hidden through the first 72% of the morph', () => {
    expect(contentRevealProgress(0)).toBe(0);
    expect(contentRevealProgress(0.5)).toBe(0);
    expect(contentRevealProgress(0.72)).toBe(0);
  });

  it('ramps linearly across the final 28% and clamps at fully revealed', () => {
    expect(contentRevealProgress(0.86)).toBeCloseTo(0.5, 5);
    expect(contentRevealProgress(0.93)).toBeCloseTo(0.75, 5);
    expect(contentRevealProgress(1)).toBe(1);
    expect(contentRevealProgress(1.2)).toBe(1);
  });
});

describe('applyContentReveal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hides the content before the reveal window opens', () => {
    const { content } = buildCard();

    applyContentReveal(content, 0);
    expect(content.style.opacity).toBe('0');
    expect(content.style.transform).toBe('translateY(4px)');
    expect(content.style.willChange).toBe('opacity, transform');

    applyContentReveal(content, 0.72);
    expect(content.style.opacity).toBe('0');
    expect(content.style.transform).toBe('translateY(4px)');
  });

  it('reveals the content part-way through the ramp', () => {
    const { content } = buildCard();

    applyContentReveal(content, 0.86);
    expect(Number(content.style.opacity)).toBeCloseTo(0.5, 5);
    const translate = content.style.transform.match(/^translateY\(([\d.]+)px\)$/);
    expect(translate).not.toBeNull();
    expect(Number(translate?.[1])).toBeCloseTo(2, 5);
  });

  it('clears every inline style once fully revealed', () => {
    const { content } = buildCard();

    applyContentReveal(content, 0.5);
    applyContentReveal(content, 0.9);
    applyContentReveal(content, 1);

    expect(content.getAttribute('style') ?? '').toBe('');
    expect(content.style.length).toBe(0);
  });

  it('never writes onto the card root or the content descendants', () => {
    const { root, content, descendants } = buildCard();

    for (const t of [0, 0.4, 0.72, 0.8, 0.9, 0.99, 1]) {
      applyContentReveal(content, t);
      expect(root.style.length).toBe(0);
      expect(inlineCustomProperties(root)).toEqual([]);
      expect(inlineCustomProperties(content)).toEqual([]);
      for (const descendant of descendants) {
        expect(descendant.getAttribute('style')).toBeNull();
      }
    }
  });

  it('is a no-op when the card has no content node', () => {
    const { root } = buildCard();
    root.innerHTML = '';

    expect(() => applyContentReveal(null, 0.5)).not.toThrow();
    expect(root.style.length).toBe(0);
    expect(root.getAttribute('style')).toBeNull();
  });
});
