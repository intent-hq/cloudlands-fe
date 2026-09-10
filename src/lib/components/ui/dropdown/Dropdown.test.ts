import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import axe from 'axe-core';
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
      const content = document.body.querySelector(
        '[data-slot="dropdown-content"]',
      ) as HTMLDivElement | null;
      expect(content).toBeTruthy();
      expect(content?.style.position).toBe('fixed');
      expect(content?.style.bottom).toBeTruthy();
      expect(content?.style.top).toBe('');
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
    const root = container.querySelector<HTMLElement>('[data-slot="dropdown-root"]')!;
    root.getBoundingClientRect = vi.fn(() => rect(120, 500, 120, 28));

    await fireEvent.click(trigger);
    const content = container.querySelector<HTMLElement>('[data-slot="dropdown-content"]')!;
    expect(content.dataset.collisionAware).toBe('true');
    expect(content.dataset.side).toBe('top');
    expect(content.style.maxHeight).toBe('360px');
    expect(content.style.bottom).toBe('32px');
    expect(boundary.contains(content)).toBe(true);

    trigger.getBoundingClientRect = vi.fn(() => rect(120, 90, 120, 28));
    root.getBoundingClientRect = vi.fn(() => rect(120, 90, 120, 28));
    await fireEvent(window, new Event('resize'));
    expect(content.dataset.side).toBe('bottom');
    expect(content.style.top).toBe('32px');
    expect(content.style.maxHeight).toBe('360px');

    const search = screen.getByRole('searchbox', { name: 'Search options' });
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');
    Object.defineProperty(listbox, 'clientHeight', { configurable: true, value: 90 });
    options.forEach((option, index) => {
      option.getBoundingClientRect = () =>
        ({ top: index * 30, bottom: index * 30 + 30, height: 30 }) as DOMRect;
    });
    expect(options.filter((option) => option.tabIndex === 0)).toEqual([options[0]]);
    await fireEvent.keyDown(search, { key: 'PageDown' });
    expect(options.filter((option) => option.tabIndex === 0)).toEqual([options[3]]);
    await fireEvent.keyDown(search, { key: 'PageUp' });
    expect(options.filter((option) => option.tabIndex === 0)).toEqual([options[0]]);
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
    const trigger = container.querySelector('button')!;
    await fireEvent.click(trigger);
    const search = await screen.findByRole('searchbox', { name: 'Search options' });
    const listbox = screen.getByRole('listbox');
    expect(search.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.getAttribute('aria-labelledby')).toBe(trigger.id);
    expect(listbox.contains(search)).toBe(false);

    await fireEvent.input(search, { target: { value: 'a' } });
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: /Beta/ }).id,
    );
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onchange).toHaveBeenCalledWith('b', undefined);
    expect(onopenchange).toHaveBeenNthCalledWith(1, true);
    expect(onopenchange).toHaveBeenNthCalledWith(2, false);
  });

  it('shares one active index between arrow navigation and pointer proximity', async () => {
    const { container } = render(Dropdown, {
      props: {
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
        searchable: false,
        portal: false,
      },
    });
    await fireEvent.click(container.querySelector('button')!);
    const listbox = await screen.findByRole('listbox');
    const options = screen.getAllByRole('option');
    const optionContainer = listbox;
    const activeIndex = optionContainer.querySelector<HTMLElement>(
      '[data-slot="menu-list-highlight"]',
    )!;
    optionContainer.getBoundingClientRect = vi.fn(() => rect(0, 0, 200, 60));
    options[0].getBoundingClientRect = vi.fn(() => rect(0, 0, 200, 30));
    options[1].getBoundingClientRect = vi.fn(() => rect(0, 30, 200, 30));

    await fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await waitFor(() => expect(activeIndex.dataset.activeIndex).toBe('1'));
    await fireEvent.pointerMove(optionContainer, { clientX: 10, clientY: 5 });
    await waitFor(() => expect(activeIndex.dataset.activeIndex).toBe('0'));
    expect(options[0].dataset.highlighted).toBe('true');
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
        portal: true,
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
    await fireEvent.mouseOver(screen.getByRole('option', { name: 'More' }));
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Child action' })).toBeTruthy();
    const axeResult = await axe.run(document.body, {
      runOnly: ['aria-required-children', 'aria-required-parent'],
    });
    expect(axeResult.violations).toEqual([]);

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
        caller: 'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
        replacement: 'Combobox',
        reason: 'catalog characterization of the deprecated value-selection wrapper',
      },
      {
        caller: 'src/lib/component-catalog/renderers/PopoversCatalogPreview.svelte',
        replacement: 'Combobox',
        reason: 'catalog characterization of the deprecated action-menu wrapper',
      },
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
        caller: 'src/lib/components/patterns/settings/custom-controls.ts',
        replacement: 'Menu',
        reason: 'settings bridge for action items and separator without value selection',
      },
    ]);
  });
});
