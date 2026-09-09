// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import SidebarHarness from './SidebarHarness.svelte';
import { sidebarFixtures } from './sidebar.fixtures';
import * as sidebarApi from './index';
import { m } from '$shared/paraglide/messages.js';

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = window.ResizeObserver;

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function stubResizeObserver() {
  class ResizeObserverStub implements ResizeObserver {
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
  }
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverStub,
  });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: originalResizeObserver,
  });
  document.cookie = 'sidebar:state=; max-age=0; path=/';
});

describe('Sidebar', () => {
  it('keeps the product inset as main while allowing embedded previews to avoid nested landmarks', () => {
    stubMatchMedia(false);
    const product = render(SidebarHarness);
    expect(product.container.querySelector('[data-slot="sidebar-inset"]')?.tagName).toBe('MAIN');
    product.unmount();

    const preview = render(SidebarHarness, { props: { insetAs: 'div' } });
    expect(preview.container.querySelector('[data-slot="sidebar-inset"]')?.tagName).toBe('DIV');
  });

  it('toggles collapsed desktop state through the public trigger and keyboard shortcut', async () => {
    stubMatchMedia(false);
    const { container } = render(SidebarHarness);
    const sidebar = container.querySelector('[data-slot="sidebar"][data-state]');
    const trigger = container.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]')!;
    expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    await fireEvent.click(trigger);
    expect(sidebar?.getAttribute('data-state')).toBe('expanded');
    expect(screen.getByLabelText('Sidebar open state').textContent).toBe('true');
    trigger.focus();
    await fireEvent.keyDown(window, { key: '[' });
    expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    expect(screen.getByLabelText('Sidebar open state').textContent).toBe('false');
  });

  it('resizes within bounds and collapses when dragged below the minimum', async () => {
    stubMatchMedia(false);
    const { container } = render(SidebarHarness, { props: { open: true } });
    const wrapper = container.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!;
    const sidebar = container.querySelector<HTMLElement>('[data-slot="sidebar"][data-state]')!;
    const rail = container.querySelector<HTMLButtonElement>('[data-sidebar="rail"]')!;

    await fireEvent.pointerDown(rail, { button: 0, clientX: 256 });
    await fireEvent.pointerMove(window, { clientX: 600 });
    await fireEvent.pointerUp(window);
    expect(wrapper.style.getPropertyValue('--sidebar-width')).toBe('360px');

    await fireEvent.pointerDown(rail, { button: 0, clientX: 360 });
    await fireEvent.pointerMove(window, { clientX: 100 });
    await fireEvent.pointerUp(window);
    expect(wrapper.style.getPropertyValue('--sidebar-width')).toBe('160px');
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
  });

  it('uses the side-aware bare shortcut only while its provider has focus', async () => {
    stubMatchMedia(false);
    const { container } = render(SidebarHarness, { props: { side: 'right' } });
    const trigger = container.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]')!;
    const sidebar = container.querySelector<HTMLElement>('[data-slot="sidebar"][data-state]')!;

    await fireEvent.keyDown(window, { key: ']' });
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    trigger.focus();
    await fireEvent.keyDown(window, { key: '[' });
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    await fireEvent.keyDown(window, { key: ']' });
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
  });

  it('peeks without persisting and dismisses on Escape or outside press', async () => {
    stubMatchMedia(false);
    const { container } = render(SidebarHarness, { props: { peek: 'click' } });
    const sidebar = container.querySelector<HTMLElement>('[data-slot="sidebar"][data-state]')!;
    const rail = container.querySelector<HTMLButtonElement>('[data-sidebar="rail"]')!;

    await fireEvent.click(rail);
    expect(sidebar.getAttribute('data-peeking')).toBe('true');
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(sidebar.getAttribute('data-peeking')).toBe('false');

    await fireEvent.click(rail);
    await fireEvent.pointerDown(document.body);
    expect(sidebar.getAttribute('data-peeking')).toBe('false');
    expect(document.cookie).not.toContain('sidebar:state=');
  });

  it('supports hover peek and hiding the built-in rail', async () => {
    stubMatchMedia(false);
    const { container, unmount } = render(SidebarHarness, { props: { peek: 'hover' } });
    const sidebar = container.querySelector<HTMLElement>('[data-slot="sidebar"][data-state]')!;
    const rail = container.querySelector<HTMLButtonElement>('[data-sidebar="rail"]')!;
    await fireEvent.pointerEnter(rail);
    expect(sidebar.getAttribute('data-peeking')).toBe('true');
    await fireEvent.pointerLeave(container.querySelector('[data-slot="sidebar-container"]')!);
    expect(sidebar.getAttribute('data-peeking')).toBe('false');
    unmount();

    const hidden = render(SidebarHarness, { props: { rail: false } });
    expect(hidden.container.querySelector('[data-sidebar="rail"]')).toBeNull();
  });

  it('exposes active, disabled, and selectable menu states through public menu APIs', async () => {
    stubMatchMedia(false);
    render(SidebarHarness, { props: { open: true, fixtureState: 'actions-and-badges' } });
    const active = screen.getByRole('button', { name: 'Overview' });
    expect(active.getAttribute('data-active')).toBe('true');
    expect(active.getAttribute('aria-current')).toBe('page');
    await fireEvent.click(active);
    expect(screen.getByLabelText('Sidebar menu selections').textContent).toBe('1');
    expect(
      (screen.getByRole('button', { name: 'Disabled navigation' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const settings = document.querySelector<HTMLButtonElement>(
      '[data-sidebar="menu-button"][data-status="unread"]',
    )!;
    settings.focus();
    await waitFor(() => expect(settings.getAttribute('data-proximity-active')).toBe('true'));
    expect(active.getAttribute('data-proximity-active')).toBe('false');
    settings.blur();
    await waitFor(() => expect(settings.getAttribute('data-proximity-active')).toBe('false'));
    expect(settings.getAttribute('data-status')).toBe('unread');
    const action = document.querySelector<HTMLElement>('[data-sidebar="menu-action"]')!;
    expect(action.getAttribute('data-show-on-hover')).toBe('true');
  });

  it('collapses grouped content through its accessible label', async () => {
    stubMatchMedia(false);
    const { container } = render(SidebarHarness, { props: { open: true } });
    const label = screen.getByRole('button', { name: 'Navigation' });
    const content = container.querySelector<HTMLElement>('[data-sidebar="group-content"]')!;
    expect(label.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(label);
    expect(label.getAttribute('aria-expanded')).toBe('false');
    expect(content.hasAttribute('inert')).toBe(true);
  });

  it('roves focus across visible rows with arrow, Home, and End keys', async () => {
    stubMatchMedia(false);
    stubResizeObserver();
    render(SidebarHarness, { props: { open: true } });
    const overview = screen.getByRole('button', { name: 'Overview' });
    const projects = screen.getByRole('button', { name: 'Projects navigation' });
    const settings = screen.getByRole('button', { name: 'Settings navigation' });

    overview.focus();
    await fireEvent.keyDown(overview, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(projects);
    await fireEvent.keyDown(projects, { key: 'End' });
    expect(document.activeElement).toBe(settings);
    await fireEvent.keyDown(settings, { key: 'Home' });
    expect(document.activeElement).toBe(overview);
  });

  it('announces unread status and renders one active highlight per selected tree level', () => {
    stubMatchMedia(false);
    const status = render(SidebarHarness, { props: { open: true, fixtureState: 'status-dots' } });
    expect(screen.getByRole('button', { name: /Projects\s*, unread/i })).not.toBeNull();
    status.unmount();

    const nested = render(SidebarHarness, { props: { open: true, fixtureState: 'nested' } });
    expect(
      nested.container.querySelectorAll('[data-sidebar="menu-active-highlight"]'),
    ).toHaveLength(3);
  });

  it('opens and dismisses the responsive mobile sheet through the public trigger', async () => {
    stubMatchMedia(true);
    render(SidebarHarness);
    expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: m.ui_sidebar_toggle_label() }));
    expect(await screen.findByRole('dialog', { name: 'Sidebar' })).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull());
  });

  it('publishes a host-independent pattern classification and complete public barrel', () => {
    expect(() => parseUiComponentMetadata(sidebarApi.sidebarMetadata)).not.toThrow();
    expect(sidebarApi.sidebarMetadata.category).toBe('pattern');
    expect(sidebarApi.sidebarMetadata.callers).toEqual(
      expect.arrayContaining(['src/lib/components/file-explorer/file-explorer-sidebar.svelte']),
    );
    expect(sidebarFixtures[0].states).toEqual(
      expect.arrayContaining([
        'default',
        'floating',
        'inset',
        'nested',
        'actions-and-badges',
        'header-footer-stacking',
        'callouts',
        'status-dots',
        'skeleton',
        'compact',
        'collapsed',
        'peek-hover',
        'resizing',
      ]),
    );
    expect(Object.keys(sidebarApi).sort()).toEqual([...sidebarApi.sidebarMetadata.exports].sort());
  });
});
