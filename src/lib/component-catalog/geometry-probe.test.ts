import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectGeometry } from './geometry-probe';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setRect(element: Element, value: DOMRect): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(value);
}

describe('collectGeometry', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('derives stable keys from the first matching attribute and suffixes duplicates', () => {
    document.body.innerHTML = `<main><div data-workspace-hover-card-title></div><div data-workspace-hover-card-agent-row></div><div data-workspace-hover-card-agent-row></div><div data-probe="item"></div><div data-workspace-hover-card-agent-detail data-workspace-hover-card-agent-preview="true"></div></main>`;
    const root = document.querySelector('main')!;
    setRect(root, rect(0, 0, 100, 100));
    for (const element of root.children) setRect(element, rect(0, 0, 10, 10));

    const result = collectGeometry(root);

    expect(Object.keys(result.probes)).toEqual([
      'data-probe=item',
      'data-workspace-hover-card-agent-detail',
      'data-workspace-hover-card-agent-row',
      'data-workspace-hover-card-agent-row#2',
      'data-workspace-hover-card-title',
    ]);
    expect(result.probes).not.toHaveProperty('data-workspace-hover-card-agent-preview=true');
  });

  it('measures relative coordinates and rounds geometry and computed styles', () => {
    document.body.innerHTML = `<main><div data-probe style="font-weight: 525; font-size: 13.333px; line-height: 17.777px; gap: 2.345px; margin-top: 4.444px; margin-bottom: 5.555px; padding-left: 6.666px; padding-right: 7.777px"></div></main>`;
    const root = document.querySelector('main')!;
    const probe = root.firstElementChild!;
    setRect(root, rect(10.111, 20.222, 300.126, 199.995));
    setRect(probe, rect(15.666, 29.999, 80.555, 40.444));

    expect(collectGeometry(root)).toEqual({
      root: { width: 300.13, height: 200 },
      probes: {
        'data-probe': {
          x: 5.56,
          y: 9.78,
          width: 80.56,
          height: 40.44,
          fontWeight: 525,
          fontSize: 13.33,
          lineHeight: 17.78,
          gap: 2.35,
          marginTop: 4.44,
          marginBottom: 5.56,
          paddingLeft: 6.67,
          paddingRight: 7.78,
        },
      },
    });
  });

  it('uses a selector instead of the default attribute walk', () => {
    document.body.innerHTML = `<main><div data-probe="excluded"></div><div class="chosen" data-probe="included"></div><span class="chosen" data-role="status"></span><i class="chosen"></i></main>`;
    const root = document.querySelector('main')!;
    setRect(root, rect(0, 0, 100, 100));
    for (const element of root.children) setRect(element, rect(0, 0, 10, 10));

    expect(Object.keys(collectGeometry(root, { selector: '.chosen' }).probes)).toEqual([
      '.chosen',
      'data-probe=included',
      'data-role=status',
    ]);
  });

  it('extends the default computed fields without duplicating them', () => {
    document.body.innerHTML = `<main><div data-probe style="border-radius: 3.456px"></div></main>`;
    const root = document.querySelector('main')!;
    const probe = root.firstElementChild!;
    setRect(root, rect(0, 0, 100, 100));
    setRect(probe, rect(0, 0, 10, 10));

    const measurement = collectGeometry(root, {
      computed: ['borderRadius', 'fontSize'],
    }).probes['data-probe'];

    expect(measurement.borderRadius).toBe(3.46);
    expect(Object.keys(measurement).filter((key) => key === 'fontSize')).toHaveLength(1);
  });
});
