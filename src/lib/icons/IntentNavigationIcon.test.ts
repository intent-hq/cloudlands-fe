import { render } from '@testing-library/svelte';
import { describe, expect, expectTypeOf, it } from 'vitest';
import IntentNavigationIcon, {
  intentNavigationIconNames,
  type IntentNavigationIconName,
} from './IntentNavigationIcon.svelte';

const expectedGeometry: Record<IntentNavigationIconName, string[]> = {
  spaces: ['rect[x="1.75"]', 'rect[x="6.75"]', 'rect[x="11.75"]'],
  tabs: [
    'path[d="M9.5 2.75H13.5C13.9142 2.75 14.25 3.08579 14.25 3.5V12.5C14.25 12.9142 13.9142 13.25 13.5 13.25H2.5C2.08579 13.25 1.75 12.9142 1.75 12.5V8.16699C1.75 7.75278 2.08579 7.41699 2.5 7.41699H8.75V3.5C8.75 3.08579 9.08579 2.75 9.5 2.75ZM2.5 2.75H5.5C5.91421 2.75 6.25 3.08579 6.25 3.5V4.16699C6.24982 4.58106 5.9141 4.91699 5.5 4.91699H2.5C2.08589 4.91699 1.75018 4.58106 1.75 4.16699V3.5C1.75 3.08579 2.08579 2.75 2.5 2.75Z"]',
  ],
  settings: ['path[d="M9 5L14 5"]', 'path[d="M2 11H7"]', 'circle[cx="5"]', 'circle[cx="11"]'],
  dandelion: [
    'path[d^="M10.4792"]',
    'path[d^="M5.52046"]',
    'path[d="M7.99985 10.667L7.99985 15.3337"]',
  ],
};

describe('IntentNavigationIcon', () => {
  it('exposes exactly the four approved icon names', () => {
    expect(intentNavigationIconNames).toEqual(['spaces', 'tabs', 'settings', 'dandelion']);
    expectTypeOf<IntentNavigationIconName>().toEqualTypeOf<
      'spaces' | 'tabs' | 'settings' | 'dandelion'
    >();
  });

  it.each(intentNavigationIconNames)('renders the exact %s vector with currentColor', (name) => {
    const { container } = render(IntentNavigationIcon, { props: { name } });
    const icon = container.querySelector('svg');

    expect(icon?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(icon?.getAttribute('width')).toBe('16');
    expect(icon?.getAttribute('height')).toBe('16');
    expectedGeometry[name].forEach((selector) =>
      expect(icon?.querySelector(selector)).toBeTruthy(),
    );
    expect(icon?.querySelectorAll('[stroke="currentColor"]')).toHaveLength(
      expectedGeometry[name].length,
    );
    expect(icon?.querySelector('[stroke="#080808"], [stroke="black"]')).toBeNull();
  });

  it('forwards size and class while remaining decorative', () => {
    const { container } = render(IntentNavigationIcon, {
      props: { name: 'spaces', size: 20, class: 'size-5 text-accent' },
    });
    const icon = container.querySelector('svg');

    expect(icon?.getAttribute('width')).toBe('20');
    expect(icon?.getAttribute('height')).toBe('20');
    expect(icon?.getAttribute('class')).toBe('size-5 text-accent');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('focusable')).toBe('false');
    expect(icon?.querySelector('title')).toBeNull();
  });

  it('gives every primary-nav variant the same 16px optical box', () => {
    const boxes = intentNavigationIconNames.map((name) => {
      const { container, unmount } = render(IntentNavigationIcon, { props: { name, size: 16 } });
      const icon = container.querySelector('svg');
      const box = [
        icon?.getAttribute('width'),
        icon?.getAttribute('height'),
        icon?.getAttribute('viewBox'),
      ];
      unmount();
      return box;
    });

    expect(new Set(boxes.map((box) => box.join('|')))).toEqual(new Set(['16|16|0 0 16 16']));
  });
});
