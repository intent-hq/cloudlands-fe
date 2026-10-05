import { afterEach, describe, expect, it } from 'vitest';
import { color } from 'd3';
import { ensureMermaidLabelContrast } from '../mermaid-label-contrast';

function fixture(content: string, background = '#161b22'): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" aria-roledescription="flowchart-v2"
    style="background-color:${background};color:#f5f5f5">${content}</svg>`;
  document.body.append(host);
  return host.querySelector('svg')!;
}

function node(id: string, fill: string, foreground: string, html = false): string {
  const text = html
    ? `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p style="color:${foreground}">${id}</p></span></div></foreignObject>`
    : `<text><tspan style="fill:${foreground}">${id}</tspan></text>`;
  return `<g class="node" id="flowchart-${id}-0"><rect class="label-container" style="fill:${fill}"/><g class="label">${text}</g></g>`;
}

// Independent WCAG oracle: never derive the expectation from the repair's choice.
function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const { r, g, b } = color(value)!.rgb();
    const channels = [r, g, b].map((channel) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function expectSameColor(actual: string, expected: string): void {
  const parsed = color(actual);
  expect(parsed).not.toBeNull();
  expect(parsed!.rgb()).toEqual(color(expected)!.rgb());
}

afterEach(() => document.body.replaceChildren());

describe('Mermaid local label contrast', () => {
  it('compares color values without depending on CSSOM serialization', () => {
    expectSameColor('rgb(255, 255, 255)', '#ffffff');
    expectSameColor('#fff', 'rgb(255, 255, 255)');
    for (const incorrect of ['#000000', '#fffffe', 'rgba(255,255,255,0.5)', 'invalid']) {
      expect(() => expectSameColor(incorrect, '#ffffff')).toThrow();
    }
  });

  it.each([false, true])('repairs pale nodes and preserves readable authors (HTML=%s)', (html) => {
    const svg = fixture(
      node('Blue', '#dbeafe', '#eeeeee', html) +
        node('Green', '#dcfce7', '#eeeeee', html) +
        node('Dark', '#172554', '#ffffff', html) +
        node('Authored', '#dbeafe', '#123456', html),
    );
    const selector = html ? 'p' : 'tspan';
    const property = html ? 'color' : 'fill';
    const texts = [...svg.querySelectorAll<SVGElement | HTMLElement>(selector)];
    const originals = texts.map((text) => text.getAttribute('style'));
    const fills = [...svg.querySelectorAll('rect')].map((shape) => shape.getAttribute('style'));
    expect(contrast(getComputedStyle(texts[0]).getPropertyValue(property), '#dbeafe')).toBeLessThan(
      4.5,
    );

    ensureMermaidLabelContrast(svg);

    for (const [index, background] of ['#dbeafe', '#dcfce7', '#172554', '#dbeafe'].entries()) {
      expect(
        contrast(getComputedStyle(texts[index]).getPropertyValue(property), background),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(texts.slice(2).map((text) => text.getAttribute('style'))).toEqual(originals.slice(2));
    expect([...svg.querySelectorAll('rect')].map((shape) => shape.getAttribute('style'))).toEqual(
      fills,
    );
    expect(texts.map((text) => text.textContent)).toEqual(['Blue', 'Green', 'Dark', 'Authored']);
  });

  it('uses semantic enclosing fills for flattened nested groups, not child colors', () => {
    const svg = fixture(`
      <g class="cluster" id="Outer"><rect style="fill:#fef3c7"/>
        <g class="cluster-label"><text style="fill:#eeeeee">Outer</text></g></g>
      <g class="cluster" id="Inner"><rect style="fill:rgba(0,0,0,0)"/>
        <g class="cluster-label"><text style="fill:#eeeeee">Inner</text></g></g>
      ${node('Push', '#172554', '#ffffff')}${node('Transparent', 'none', '#eeeeee')}`);
    const membership = new Map([
      ['Outer', new Set(['Inner', 'Push', 'Transparent'])],
      ['Inner', new Set(['Push', 'Transparent'])],
    ]);
    const push = svg.querySelector<SVGElement>('#flowchart-Push-0 tspan')!;
    const originalFill = push.style.fill;
    const originalPriority = push.style.getPropertyPriority('fill');
    ensureMermaidLabelContrast(svg, membership);
    for (const text of svg.querySelectorAll<SVGElement>(
      '.cluster-label text, #flowchart-Transparent-0 tspan',
    )) {
      expect(contrast(getComputedStyle(text).fill, '#fef3c7')).toBeGreaterThanOrEqual(4.5);
    }
    expectSameColor(getComputedStyle(push).fill, '#ffffff');
    expect(contrast(getComputedStyle(push).fill, '#172554')).toBeGreaterThanOrEqual(4.5);
    expect(push.style.fill).toBe(originalFill);
    expect(push.style.getPropertyPriority('fill')).toBe(originalPriority);
  });

  it.each([false, true])('preserves a readable authored group foreground (HTML=%s)', (html) => {
    const label = html
      ? '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span style="color:#123456 !important">Group</span></div></foreignObject>'
      : '<text style="fill:#123456 !important">Group</text>';
    const svg = fixture(`<g class="cluster"><rect style="fill:#fef3c7"/>
      <g class="cluster-label">${label}</g></g>`);
    const before = svg.innerHTML;
    ensureMermaidLabelContrast(svg);
    expect(svg.innerHTML).toBe(before);
  });

  it.each(['rgba(255,255,255,0.1)', '#ffffff1a', '#ffffff;fill-opacity:0.1'])(
    'composites translucent fill %s against a dark canvas',
    (fill) => {
      const svg = fixture(node('Translucent', fill, '#222222'), '#000000');
      ensureMermaidLabelContrast(svg);
      expect(
        contrast(getComputedStyle(svg.querySelector('tspan')!).fill, '#1a1a1a'),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['', 'important'])(
    'reconsiders the original foreground when a transparent backdrop changes (priority=%s)',
    (priority) => {
      const foreground = priority ? '#ffffff !important' : '#ffffff';
      const svg = fixture(node('Transparent', 'none', foreground), '#ffffff');
      const text = svg.querySelector<SVGElement>('tspan')!;
      const originalFill = text.style.fill;
      const originalPriority = text.style.getPropertyPriority('fill');
      ensureMermaidLabelContrast(svg);
      expect(contrast(getComputedStyle(text).fill, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      svg.style.backgroundColor = '#000000';
      for (let repeat = 0; repeat < 2; repeat++) {
        ensureMermaidLabelContrast(svg);
        expectSameColor(getComputedStyle(text).fill, '#ffffff');
        expect(contrast(getComputedStyle(text).fill, '#000000')).toBeGreaterThanOrEqual(4.5);
        expect(text.style.fill).toBe(originalFill);
        expect(text.style.getPropertyPriority('fill')).toBe(originalPriority);
      }
    },
  );

  it('accounts for HTML label backgrounds and nested authored text independently', () => {
    const svg = fixture(`<g class="node"><rect style="fill:#000000"/><g class="label">
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="background-color:#ffffff">
        <p style="color:#eeeeee">Label <b style="color:#123456">Authored</b></p>
      </div></foreignObject></g></g>`);
    ensureMermaidLabelContrast(svg);
    expect(
      contrast(getComputedStyle(svg.querySelector('p')!).color, '#ffffff'),
    ).toBeGreaterThanOrEqual(4.5);
    expect(svg.querySelector<HTMLElement>('b')!.style.color).toBe('rgb(18, 52, 86)');
  });

  it('does not invent missing text or change hidden labels and unknown surfaces', () => {
    const svg = fixture(`${node('Unknown', 'url(#gradient)', '#eeeeee')}
      <g class="node"><rect style="fill:#ffffff"/><g class="label">
        <text style="fill:none">No paint</text><text style="fill:#fff;opacity:0">Hidden</text>
        <text style="fill:#fff;visibility:hidden">Invisible</text><text></text>
      </g></g>`);
    const before = svg.innerHTML;
    ensureMermaidLabelContrast(svg);
    expect(svg.innerHTML).toBe(before);
  });
});
