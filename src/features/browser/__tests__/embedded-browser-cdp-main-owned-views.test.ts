/**
 * The CDP service with main-owned browser views (BrowserViewService): such a
 * page is not of type `webview` and has no `hostWebContents`, so the service
 * asks the MainOwnedBrowserViews seam to list it, to find the renderer that
 * shows it, and to park it while a capture needs frames.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllWebContents: vi.fn(() => [] as unknown[]),
  fromId: vi.fn<(id: number) => unknown>(() => undefined),
}));

vi.mock('electron', () => ({
  __esModule: true,
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  webContents: { getAllWebContents: mocks.getAllWebContents, fromId: mocks.fromId },
  default: {},
}));

vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
  getWindowIdsForWorkspace: vi.fn(() => []),
}));

const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

const LAYOUT_METRICS = {
  layoutViewport: { clientWidth: 800, clientHeight: 600 },
  cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
};

/** A main-owned page: type `browserView`, no host webContents. */
function fakeMainOwnedPage(id: number) {
  return {
    id,
    getType: () => 'browserView',
    isDestroyed: () => false,
    getURL: () => 'https://page.test/',
    getTitle: () => `page-${id}`,
    once: vi.fn(),
    removeListener: vi.fn(),
    backgroundThrottling: true,
    hostWebContents: null,
    debugger: {
      isAttached: () => true,
      attach: vi.fn(),
      on: vi.fn(),
      sendCommand: vi.fn(async (method: string) =>
        method === 'Page.getLayoutMetrics' ? LAYOUT_METRICS : { data: JPEG_1PX },
      ),
    },
  };
}

function fakeMachineView() {
  return { id: 1, isDestroyed: () => false, send: vi.fn(), backgroundThrottling: true };
}

async function loadService() {
  const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
  return embeddedBrowserCdp;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.fromId.mockImplementation((id) =>
    mocks.getAllWebContents().find((wc) => (wc as { id: number }).id === id),
  );
});

describe('embedded browser CDP with main-owned browser views', () => {
  it('lists a main-owned page as a tab, and no other non-webview contents', async () => {
    const service = await loadService();
    const page = fakeMainOwnedPage(41);
    const other = { ...fakeMainOwnedPage(42), getType: () => 'window' };
    mocks.getAllWebContents.mockReturnValue([page, other]);
    service.setMainOwnedBrowserViews({
      owns: (id) => id === 41,
      hostFor: () => undefined,
      holdDrawing: () => undefined,
    });

    service.registerTab('tab-main', 41, 'ws-1');

    expect(service.listTabs().map((tab) => tab.tabId)).toEqual(['tab-main']);
    expect(service.isTabMounted('tab-main')).toBe(true);
    service.unregisterTab('tab-main');
    service.setMainOwnedBrowserViews(null);
    expect(service.listTabs()).toEqual([]);
  });

  it('parks the page and lifts throttling on its machine view for a screenshot', async () => {
    const service = await loadService();
    const page = fakeMainOwnedPage(51);
    const machine = fakeMachineView();
    mocks.getAllWebContents.mockReturnValue([page]);
    const order: string[] = [];
    const seen: Array<[boolean, boolean, boolean]> = [];
    let parked = false;
    service.setMainOwnedBrowserViews({
      owns: (id) => id === 51,
      hostFor: (id) => (id === 51 ? (machine as unknown as Electron.WebContents) : undefined),
      holdDrawing: (id) => {
        if (id !== 51) return undefined;
        parked = true;
        order.push('park');
        return () => {
          // Released after the throttling holds are restored.
          order.push(`unpark:${page.backgroundThrottling}:${machine.backgroundThrottling}`);
          parked = false;
        };
      },
    });
    page.debugger.sendCommand.mockImplementation(async (method: string) => {
      seen.push([parked, page.backgroundThrottling, machine.backgroundThrottling]);
      return method === 'Page.getLayoutMetrics' ? LAYOUT_METRICS : { data: JPEG_1PX };
    });
    service.registerTab('tab-parked', 51, 'ws-1');

    await expect(service.screenshot('tab-parked')).resolves.toMatchObject({ base64: JPEG_1PX });

    expect(seen.length).toBeGreaterThan(0);
    expect(
      seen.every(([p, pageThrottled, hostThrottled]) => p && !pageThrottled && !hostThrottled),
    ).toBe(true);
    expect(order).toEqual(['park', 'unpark:true:true']);
    expect(machine.send).toHaveBeenCalledWith('browser:capture-drawing', { active: true });
    expect(machine.send).toHaveBeenCalledWith('browser:capture-drawing', { active: false });
    service.unregisterTab('tab-parked');
    service.setMainOwnedBrowserViews(null);
  });
  it('moves an agent drawing hold to the new host when the page moves to another window', async () => {
    const service = await loadService();
    const page = fakeMainOwnedPage(61);
    const oldHost = fakeMachineView();
    const newHost = { ...fakeMachineView(), id: 2 };
    mocks.getAllWebContents.mockReturnValue([page]);
    let host: typeof oldHost = oldHost;
    const releases: string[] = [];
    service.setMainOwnedBrowserViews({
      owns: (id) => id === 61,
      hostFor: (id) => (id === 61 ? (host as unknown as Electron.WebContents) : undefined),
      holdDrawing: () => {
        const at = host === oldHost ? 'old' : 'new';
        return () => releases.push(at);
      },
    });
    service.registerTab('tab-move', 61, 'ws-1');
    service.setTabOwner('tab-move', 'agent-1');
    const end = service.beginAgentDrawing('tab-move', 'agent-1');
    expect(oldHost.backgroundThrottling).toBe(false);

    // BrowserViewService.moveToWindow keeps the webContents id and registers again.
    host = newHost;
    service.registerTab('tab-move', 61, 'ws-1');

    expect(oldHost.backgroundThrottling).toBe(true);
    expect(oldHost.send).toHaveBeenCalledWith('browser:agent-drawing', {
      tabId: 'tab-move',
      active: false,
    });
    expect(newHost.backgroundThrottling).toBe(false);
    expect(newHost.send).toHaveBeenCalledWith('browser:agent-drawing', {
      tabId: 'tab-move',
      active: true,
    });
    expect(releases).toEqual(['old']);
    expect(service.hasAgentDrawingHold('tab-move')).toBe(true);
    end();
    service.unregisterTab('tab-move');
    service.setMainOwnedBrowserViews(null);
  });
});
