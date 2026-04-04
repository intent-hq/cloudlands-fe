import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLink, createGlobalLinkClickHandler, createLinkClickHandler } from './link-handler';

// Mock the dynamic imports used by handleLink
vi.mock('$lib/utils/workspaces-link-handler', () => ({
  handleIntentLink: vi.fn().mockResolvedValue(true),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn().mockReturnValue({
    openBrowserPanel: vi.fn(),
  }),
}));

// Mock the tooltip handler so createGlobalLinkClickHandler doesn't fail
vi.mock('$lib/components/ui/tooltip/link-tooltip-state.svelte', () => ({
  showLinkTooltip: vi.fn(),
  hideLinkTooltip: vi.fn(),
}));

describe('handleLink – devspace://terminal routing', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  it('should dispatch workspace:open-terminal for devspace://terminal/{id}', async () => {
    const result = await handleLink('devspace://terminal/term-123', {});

    expect(result).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledOnce();

    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('workspace:open-terminal');
    expect(event.detail).toEqual({ terminalId: 'term-123' });
  });

  it('should decode URI-encoded terminal IDs', async () => {
    const result = await handleLink('devspace://terminal/terminal%20with%20spaces', {});

    expect(result).toBe(true);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ terminalId: 'terminal with spaces' });
  });

  it('should return false for unhandled devspace:// types', async () => {
    const result = await handleLink('devspace://unknown/some-id', {});

    expect(result).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('should not interfere with intent:// links', async () => {
    const result = await handleLink('intent://local/note/spec', {});

    // intent:// links are handled by handleIntentLink (mocked to return true)
    expect(result).toBe(true);
    // No workspace:open-terminal event should be dispatched
    const terminalEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'workspace:open-terminal',
    );
    expect(terminalEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Shared click-path regression tests
//
// These tests verify that the click wrappers (createGlobalLinkClickHandler,
// createLinkClickHandler) correctly extract the href from an <a> element and
// route it through handleLink.  A regression here would mean terminal links
// silently do nothing even though handleLink itself still supports them.
// ---------------------------------------------------------------------------

/** Helper: build a container with an <a> tag and simulate a click on it. */
function buildContainerWithLink(href: string): { container: HTMLDivElement; anchor: HTMLAnchorElement } {
  const container = document.createElement('div');
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = 'link';
  container.appendChild(anchor);
  document.body.appendChild(container);
  return { container, anchor };
}

/** Helper: create a MouseEvent that targets the given element. */
function clickOn(el: HTMLElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: el, writable: false });
  return event;
}

describe('createGlobalLinkClickHandler – click-path regression', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
    // Clean up any containers appended to body
    document.body.innerHTML = '';
  });

  it('should route devspace://terminal links to workspace:open-terminal via click', async () => {
    const { container, anchor } = buildContainerWithLink('devspace://terminal/abc-456');
    const cleanup = createGlobalLinkClickHandler(container, {});

    // Simulate a click on the anchor
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Allow the async handler to settle
    await vi.waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalled();
    });

    const terminalEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'workspace:open-terminal',
    );
    expect(terminalEvents).toHaveLength(1);
    expect((terminalEvents[0][0] as CustomEvent).detail).toEqual({ terminalId: 'abc-456' });

    cleanup();
  });

  it('should still route intent:// links without dispatching terminal events', async () => {
    const { container, anchor } = buildContainerWithLink('intent://local/note/spec');
    const cleanup = createGlobalLinkClickHandler(container, {});

    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      // handleIntentLink mock resolves — no terminal event should fire
      const terminalEvents = dispatchSpy.mock.calls.filter(
        (call) => (call[0] as Event).type === 'workspace:open-terminal',
      );
      expect(terminalEvents).toHaveLength(0);
    });

    cleanup();
  });

  it('should ignore clicks that do not land on an <a> element', async () => {
    const container = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = 'not a link';
    container.appendChild(span);
    document.body.appendChild(container);

    const cleanup = createGlobalLinkClickHandler(container, {});

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Give async handler a tick
    await new Promise((r) => setTimeout(r, 20));

    // Nothing should have been dispatched
    const terminalEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'workspace:open-terminal',
    );
    expect(terminalEvents).toHaveLength(0);

    cleanup();
  });

  it('cleanup should remove the click listener', async () => {
    const { container, anchor } = buildContainerWithLink('devspace://terminal/cleanup-test');
    const cleanup = createGlobalLinkClickHandler(container, {});

    // Remove the handler
    cleanup();

    // Click after cleanup — should not route
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));

    const terminalEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'workspace:open-terminal',
    );
    expect(terminalEvents).toHaveLength(0);
  });
});

describe('createLinkClickHandler (deprecated) – click-path regression', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('should route devspace://terminal links through handleLink', async () => {
    const handler = createLinkClickHandler({});

    const { anchor } = buildContainerWithLink('devspace://terminal/legacy-term');

    // createLinkClickHandler returns a raw handler — call it directly
    const event = clickOn(anchor);
    await handler(event);

    const terminalEvents = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as Event).type === 'workspace:open-terminal',
    );
    expect(terminalEvents).toHaveLength(1);
    expect((terminalEvents[0][0] as CustomEvent).detail).toEqual({ terminalId: 'legacy-term' });
  });
});

