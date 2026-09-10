import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import BrowserViewerTabHeader from './BrowserViewerTabHeader.svelte';

const online = { name: 'office-linux', connected: true };
const offline = { name: 'travel-air', connected: false };

const navButtons = () => [
  screen.getByRole('button', { name: m.browser_embedded_goBack_ariaLabel() }),
  screen.getByRole('button', { name: m.browser_embedded_goForward_ariaLabel() }),
  screen.getByRole('button', { name: m.browser_embedded_refresh_ariaLabel() }),
  screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
  screen.getByRole('button', { name: m.browser_embedded_close_ariaLabel() }),
];

describe('BrowserViewerTabHeader', () => {
  afterEach(cleanup);

  it('submits an edited address as a navigation request to the host', async () => {
    const onNavigate = vi.fn();
    render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev/docs', host: online, onNavigate },
    });

    await fireEvent.click(
      screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
    );
    const input = screen.getByRole('textbox', {
      name: m.browser_embedded_addressInput_ariaLabel(),
    });
    await fireEvent.input(input, { target: { value: 'https://intentapp.dev/changelog' } });
    await fireEvent.submit(input.closest('form')!);

    expect(onNavigate).toHaveBeenCalledWith('https://intentapp.dev/changelog');
  });

  it('normalizes a bare hostname like the local address bars before forwarding it', async () => {
    const onNavigate = vi.fn();
    render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev/docs', host: online, onNavigate },
    });

    await fireEvent.click(
      screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
    );
    const input = screen.getByRole('textbox', {
      name: m.browser_embedded_addressInput_ariaLabel(),
    });
    await fireEvent.input(input, { target: { value: 'localhost:5173/app' } });
    await fireEvent.submit(input.closest('form')!);

    expect(onNavigate).toHaveBeenCalledWith('http://localhost:5173/app');
  });

  it('keeps editing and flags the address instead of forwarding an input the local bars reject', async () => {
    const onNavigate = vi.fn();
    render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev/docs', host: online, onNavigate },
    });

    await fireEvent.click(
      screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
    );
    const input = screen.getByRole('textbox', {
      name: m.browser_embedded_addressInput_ariaLabel(),
    });
    await fireEvent.input(input, { target: { value: 'javascript:alert(1)' } });
    await fireEvent.submit(input.closest('form')!);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('textbox', { name: m.browser_embedded_addressInput_ariaLabel() })).toBe(
      input,
    );
  });

  it('does not request navigation when the address is submitted unchanged', async () => {
    const onNavigate = vi.fn();
    render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev/docs', host: online, onNavigate },
    });

    await fireEvent.click(
      screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
    );
    const input = screen.getByRole('textbox', {
      name: m.browser_embedded_addressInput_ariaLabel(),
    });
    await fireEvent.submit(input.closest('form')!);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('cancels an open address edit when the host disconnects and does not submit it', async () => {
    const onNavigate = vi.fn();
    const { rerender } = render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev/docs', host: online, onNavigate },
    });

    await fireEvent.click(
      screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
    );
    const input = screen.getByRole('textbox', {
      name: m.browser_embedded_addressInput_ariaLabel(),
    });
    await fireEvent.input(input, { target: { value: 'https://intentapp.dev/changelog' } });
    const form = input.closest('form')!;

    await rerender({ host: offline });
    await fireEvent.submit(form);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('textbox', { name: m.browser_embedded_addressInput_ariaLabel() }),
    ).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: m.browser_embedded_editAddress_ariaLabel(),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('routes history and refresh controls, and close as a non-forced close', async () => {
    const handlers = {
      onGoBack: vi.fn(),
      onGoForward: vi.fn(),
      onRefresh: vi.fn(),
      onClose: vi.fn(),
    };
    render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev/docs', host: online, ...handlers },
    });
    const [back, forward, refresh, , close] = navButtons();

    await fireEvent.click(back);
    await fireEvent.click(forward);
    await fireEvent.click(refresh);
    await fireEvent.click(close);

    expect(handlers.onGoBack).toHaveBeenCalledTimes(1);
    expect(handlers.onGoForward).toHaveBeenCalledTimes(1);
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledWith({ force: false });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('disables history when the mirror webview cannot go back or forward', () => {
    render(BrowserViewerTabHeader, {
      props: {
        url: 'https://intentapp.dev/docs',
        host: online,
        canGoBack: false,
        canGoForward: false,
      },
    });
    const [back, forward, refresh] = navButtons() as HTMLButtonElement[];
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);
    expect(refresh.disabled).toBe(false);
  });

  it('pauses navigation while the host is offline and offers a force-close', async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(BrowserViewerTabHeader, {
      props: { url: 'https://intentapp.dev/docs', host: offline, onNavigate, onClose },
    });

    for (const button of navButtons() as HTMLButtonElement[]) expect(button.disabled).toBe(true);
    await fireEvent.click(
      screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
    );
    expect(
      screen.queryByRole('textbox', { name: m.browser_embedded_addressInput_ariaLabel() }),
    ).toBeNull();

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('travel-air');
    await fireEvent.click(
      screen.getByRole('button', { name: m.browser_viewer_forceClose_label() }),
    );
    expect(onClose).toHaveBeenCalledWith({ force: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
