import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Dropdown from './Dropdown.svelte';
import { dropdownCallerLedger } from './dropdown-caller-ledger';
import { buildUiComponentInventory } from '../../../../../scripts/ui-component-inventory';
import { warmImport } from '../../../../test/warm-import';

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

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../__tests__/mocks/Fa.svelte'));

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

  it('keeps opt-in inline content inside its collision boundary and flips on resize', async () => {
    const boundary = document.createElement('div');
    boundary.dataset.dropdownBoundary = '';
    boundary.getBoundingClientRect = vi.fn(() => rect(80, 60, 440, 500));
    document.body.appendChild(boundary);

    const { container } = render(Dropdown, {
      target: boundary,
      props: {
        options: Array.from({ length: 12 }, (_, index) => ({
          value: `option-${index}`,
          label: `Option ${index}`,
        })),
        portal: false,
        collisionBoundary: '[data-dropdown-boundary]',
      },
    });
    const trigger = container.querySelector('button') as HTMLButtonElement;
    trigger.getBoundingClientRect = vi.fn(() => rect(120, 500, 120, 28));
    trigger.parentElement!.getBoundingClientRect = vi.fn(() => rect(120, 500, 120, 28));

    await fireEvent.click(trigger);
    const listbox = await screen.findByRole('listbox');
    expect(listbox.dataset.collisionAware).toBe('true');
    expect(listbox.dataset.side).toBe('top');
    expect(listbox.style.maxHeight).toBe('360px');
    expect(listbox.style.bottom).toBe('32px');
    expect(boundary.contains(listbox)).toBe(true);

    trigger.getBoundingClientRect = vi.fn(() => rect(120, 90, 120, 28));
    trigger.parentElement!.getBoundingClientRect = vi.fn(() => rect(120, 90, 120, 28));
    await fireEvent(window, new Event('resize'));
    expect(listbox.dataset.side).toBe('bottom');
    expect(listbox.style.top).toBe('32px');
    expect(listbox.style.maxHeight).toBe('360px');

    const search = screen.getByRole('searchbox', { name: 'Search options' });
    await fireEvent.keyDown(search, { key: 'End' });
    expect(screen.getByRole('option', { name: 'Option 11' }).dataset.highlighted).toBe('true');
    await fireEvent.keyDown(search, { key: 'Home' });
    expect(screen.getByRole('option', { name: 'Option 0' }).dataset.highlighted).toBe('true');
  });
});

describe('Dropdown compatibility modes', () => {
  beforeEach(setupDropdownEnv);
  afterEach(cleanupDropdownEnv);

  it.each([false, true])('keeps owned popup interactions inside (portal=%s)', async (portal) => {
    render(Dropdown, { props: { portal, options: [{ value: 'a', label: 'Alpha' }] } });
    const trigger = screen.getByRole('button');
    await fireEvent.click(trigger);
    const listbox = await screen.findByRole('listbox');
    const nestedTrigger = document.createElement('button');
    nestedTrigger.setAttribute('aria-controls', 'nested-popup');
    listbox.appendChild(nestedTrigger);
    const popup = document.createElement('div');
    popup.id = 'nested-popup';
    const option = document.createElement('button');
    popup.appendChild(option);
    document.body.appendChild(popup);

    await fireEvent.mouseDown(option);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const unrelatedPopup = document.createElement('div');
    unrelatedPopup.setAttribute('role', 'listbox');
    document.body.appendChild(unrelatedPopup);
    await fireEvent.mouseDown(unrelatedPopup);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('restores trigger focus when Escape dismisses the menu', async () => {
    render(Dropdown, { props: { options: [{ value: 'a', label: 'Alpha' }] } });
    const trigger = screen.getByRole('button');
    await fireEvent.click(trigger);
    const search = screen.getByRole('searchbox');
    search.focus();
    await fireEvent.keyDown(search, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('preserves searchable keyboard selection and open-state callbacks', async () => {
    const onchange = vi.fn();
    const onopenchange = vi.fn();
    const { container } = render(Dropdown, {
      props: {
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta', description: 'Second option' },
        ],
        onchange,
        onopenchange,
      },
    });
    await fireEvent.click(container.querySelector('button')!);
    const search = await screen.findByRole('searchbox', { name: 'Search options' });
    await fireEvent.input(search, { target: { value: 'Second' } });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onchange).toHaveBeenCalledWith('b', undefined);
    expect(onopenchange).toHaveBeenNthCalledWith(1, true);
    expect(onopenchange).toHaveBeenNthCalledWith(2, false);
  });

  it('searches grouped options by both the display label and search label', async () => {
    const { container } = render(Dropdown, {
      props: {
        groups: [
          {
            key: 'legacy',
            label: 'Legacy models',
            searchLabel: 'Auggie',
            options: [{ value: 'opus', label: 'Opus 4.1' }],
          },
        ],
      },
    });
    await fireEvent.click(container.querySelector('button')!);
    const search = await screen.findByRole('searchbox', { name: 'Search options' });

    await fireEvent.input(search, { target: { value: 'Legacy' } });
    expect(screen.getByRole('option', { name: 'Opus 4.1' })).toBeTruthy();

    await fireEvent.input(search, { target: { value: 'Auggie' } });
    expect(screen.getByRole('option', { name: 'Opus 4.1' })).toBeTruthy();
  });

  it('preserves multi-select, toggle, action, separator, and submenu modes', async () => {
    const onchange = vi.fn();
    const action = vi.fn();
    const { container } = render(Dropdown, {
      props: {
        multiple: true,
        searchable: false,
        onchange,
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'separator', label: '', type: 'separator' },
          { value: 'toggle', label: 'Toggle detail', type: 'toggle', checked: true },
          { value: 'action', label: 'Run action', type: 'action', onclick: action },
          {
            value: 'submenu',
            label: 'More',
            type: 'submenu',
            children: [{ value: 'child', label: 'Child action' }],
          },
        ],
      },
    });
    await fireEvent.click(container.querySelector('button')!);
    await fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onchange).toHaveBeenCalledWith(['a'], expect.any(MouseEvent));
    expect(screen.getByRole('listbox')).toBeTruthy();

    await fireEvent.click(screen.getByRole('option', { name: 'Toggle detail' }));
    expect(onchange).toHaveBeenCalledWith('toggle', expect.any(MouseEvent));
    await fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'More' }).parentElement!);
    expect(await screen.findByRole('menu')).toBeTruthy();

    await fireEvent.click(screen.getByRole('option', { name: 'Run action' }));
    expect(action).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('preserves disabled and empty states', async () => {
    const { container, unmount } = render(Dropdown, {
      props: { disabled: true, options: [{ value: 'a', label: 'Alpha' }] },
    });
    const trigger = container.querySelector('button')!;
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    unmount();

    const emptyRender = render(Dropdown, { props: { options: [], searchable: false } });
    await fireEvent.click(emptyRender.container.querySelector('button')!);
    expect(screen.getByText('No results found')).toBeTruthy();
  });
});

describe('Dropdown caller migration ledger', () => {
  it('classifies every authoritative caller by its actual behavior', () => {
    const inventoryEntry = buildUiComponentInventory().components.find(
      (component) => component.publicImport === '$lib/components/ui/dropdown',
    );
    const inventoryCallers = inventoryEntry?.callers;
    expect(inventoryEntry?.replacement).toBe(
      'ledger:src/lib/components/ui/dropdown/dropdown-caller-ledger.ts',
    );
    expect(dropdownCallerLedger.map(({ caller }) => caller).sort()).toEqual(inventoryCallers);
    expect([...new Set(dropdownCallerLedger.map(({ replacement }) => replacement))].sort()).toEqual(
      ['Combobox', 'Menu', 'Select'],
    );
    expect(dropdownCallerLedger).toEqual([
      {
        caller: 'src/lib/components/chat/input/ModelPicker.svelte',
        replacement: 'Combobox',
        reason: 'searchable grouped value selection',
      },
      {
        caller: 'src/lib/components/chat/input/ModelPickerGroupHeader.svelte',
        replacement: 'Combobox',
        reason: 'group header support for ModelPicker',
      },
      {
        caller: 'src/lib/components/chat/input/model-picker-groups.ts',
        replacement: 'Combobox',
        reason: 'grouped option model for ModelPicker',
      },
      {
        caller: 'src/lib/components/chat/input/model-picker-utils.ts',
        replacement: 'Combobox',
        reason: 'searchable option model for ModelPicker',
      },
      {
        caller: 'src/lib/components/layout/sidebar-nav/cards/ChiefCard.svelte',
        replacement: 'Select',
        reason: 'non-searchable single-value selection',
      },
      {
        caller: 'src/lib/components/chat/input/ModelPickerOptionItem.svelte',
        replacement: 'Combobox',
        reason: 'shared option model for ModelPicker',
      },
      {
        caller: 'src/lib/components/settings/mcp/McpServerCard.svelte',
        replacement: 'Menu',
        reason: 'action items and separator without value selection',
      },
    ]);
  });
});
