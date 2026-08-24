/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PaneInsertionTargets from '../PaneInsertionTargets.svelte';

afterEach(() => cleanup());

describe('PaneInsertionTargets', () => {
  it('renders every full-height gutter and labels only the exact active boundary', () => {
    const { container } = render(PaneInsertionTargets, {
      props: {
        targets: [
          { index: 0, left: 0, width: 32 },
          { index: 1, left: 184, width: 32 },
          { index: 2, left: 368, width: 32 },
        ],
        activeIndex: 1,
      },
    });

    const targets = [...container.querySelectorAll<HTMLElement>('[data-pane-insertion-target]')];
    expect(targets).toHaveLength(3);
    expect(targets.every((target) => target.classList.contains('inset-y-0'))).toBe(true);
    expect(targets.map((target) => [target.style.left, target.style.width])).toEqual([
      ['0px', '32px'],
      ['184px', '32px'],
      ['368px', '32px'],
    ]);
    expect(targets[1].dataset.active).toBe('true');
    expect(targets[1].classList.contains('motion-reduce:transition-none')).toBe(true);
    expect(targets[1].textContent).toContain('New column');
    expect(targets[0].textContent).not.toContain('New column');
  });
});
