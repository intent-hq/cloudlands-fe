import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/svelte';
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

function setupDropdownEnv() {
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
}

function cleanupDropdownEnv() {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
}

describe('Dropdown duplicate option handling', () => {
  beforeEach(setupDropdownEnv);
  afterEach(cleanupDropdownEnv);

  it('renders without error when flat options contain duplicate values', async () => {
    const { container } = render(Dropdown, {
      props: {
        value: 'a',
        options: [
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' },
          { value: 'a', label: 'Option A (dup)' },
        ],
        searchable: false,
        portal: false,
      },
    });

    const trigger = container.querySelector('button') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    await fireEvent.click(trigger);

    await waitFor(() => {
      const listbox = document.body.querySelector('[role="listbox"]');
      expect(listbox).toBeTruthy();
      // Should render only 2 unique options, not 3
      const optionEls = listbox!.querySelectorAll('[role="option"]');
      expect(optionEls.length).toBe(2);
    });
  });

  it('renders without error when grouped options contain duplicate values', async () => {
    const { container } = render(Dropdown, {
      props: {
        value: 'model-1',
        groups: [
          {
            key: 'provider-a',
            label: 'Provider A',
            options: [
              { value: 'model-1', label: 'Model 1' },
              { value: 'model-2', label: 'Model 2' },
              { value: 'model-1', label: 'Model 1 (dup)' },
            ],
          },
        ],
        searchable: false,
        portal: false,
      },
    });

    const trigger = container.querySelector('button') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    await fireEvent.click(trigger);

    await waitFor(() => {
      const listbox = document.body.querySelector('[role="listbox"]');
      expect(listbox).toBeTruthy();
      const optionEls = listbox!.querySelectorAll('[role="option"]');
      expect(optionEls.length).toBe(2);
    });
  });
});

describe('Dropdown portal positioning', () => {
  beforeEach(setupDropdownEnv);
  afterEach(cleanupDropdownEnv);

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