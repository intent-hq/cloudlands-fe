import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import Dropdown from './Dropdown.svelte';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faChevronDown: { iconName: 'chevron-down' },
  faChevronRight: { iconName: 'chevron-right' },
}));

describe('Dropdown portal positioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 600,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('positions portal content above the trigger when space below is insufficient', async () => {
    const { container } = render(Dropdown, {
      props: {
        value: 'auggie',
        options: [
          { value: 'auggie', label: 'Auggie' },
          { value: 'codex', label: 'Codex' },
        ],
        searchable: false,
        portal: true,
      },
    });

    const trigger = container.querySelector('button') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    const triggerRect = {
      x: 24,
      y: 560,
      width: 120,
      height: 24,
      top: 560,
      right: 144,
      bottom: 584,
      left: 24,
      toJSON: () => ({}),
    } as DOMRect;

    trigger!.getBoundingClientRect = vi.fn(() => triggerRect);

    await fireEvent.click(trigger!);

    await waitFor(() => {
      const listbox = document.body.querySelector('[role="listbox"]') as HTMLDivElement | null;
      expect(listbox).toBeTruthy();
      expect(listbox?.style.position).toBe('fixed');
      expect(listbox?.style.bottom).toBeTruthy();
      expect(listbox?.style.top).toBe('');
    });
  });
});