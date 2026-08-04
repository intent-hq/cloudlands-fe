/**
 * Connection toast service tests.
 *
 * Runs a REAL HardwareConsoleManager against the fake WebHID surface with an
 * RPC auto-responder (requests decoded from the device's sent report-6
 * frames, replies injected back as channel-2 JSON), so the probe traffic is
 * exercised end to end. Only the toast lib (`vi.mock('svelte-sonner')`,
 * existing pattern) and settings navigation are faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSuccessMock, toastInfoMock, toastWarningMock, navigateToRouteMock } = vi.hoisted(
  () => ({
    toastSuccessMock: vi.fn(),
    toastInfoMock: vi.fn(),
    toastWarningMock: vi.fn(),
    navigateToRouteMock: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock('svelte-sonner', () => ({
  toast: {
    success: toastSuccessMock,
    info: toastInfoMock,
    warning: toastWarningMock,
  },
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: navigateToRouteMock,
  isHudWindowRenderer: () => false,
}));

import { installHardwareConsoleConnectionToasts } from '../connection-toast-service';
import { HardwareConsoleManager } from '../device/device-manager';
import { decodeFrame } from '../device/frame';
import { createWebHidPlatform } from '../device/platform';
import { FakeHidDevice, FakeWebHidApi, flushMicrotasks } from '../device/__tests__/fake-hid';

const CM2 = { vendorId: 0x303a, productId: 0x8297 };
const CODEX_KEYMAP = JSON.stringify({ layers: [['KC_A'], ['KV_OAI_AGENT_1']] });

/** One usage pair per sibling device (split enumeration). Not the exact
 *  live-verified USB pair set: indices 0-2 carry no USB-only collection
 *  (so `makeSetup(4)` models the 4-pair BLE surface), indices 3-4 add the
 *  USB-only mouse/gamepad pairs (so `makeSetup(6)` labels USB). Inference
 *  only cares about USB-only presence and total count. */
const SIBLING_PAIRS = [
  { usagePage: 0x0001, usage: 0x0006 }, // keyboard
  { usagePage: 0x000c, usage: 0x0001 }, // consumer
  { usagePage: 0x000c, usage: 0x0002 },
  { usagePage: 0x0001, usage: 0x0002 }, // mouse (USB-only)
  { usagePage: 0x0001, usage: 0x0005 }, // gamepad (USB-only)
];

/** CM2 USB enumeration coalesced into one device: all 6 usage pairs. */
const USB_COALESCED_PAIRS = [
  { usagePage: 0x0001, usage: 0x0006 },
  { usagePage: 0x000c, usage: 0x0001 },
  { usagePage: 0x0001, usage: 0x0002 },
  { usagePage: 0x0001, usage: 0x0001 },
  { usagePage: 0x0001, usage: 0x0005 },
  { usagePage: 0xff00, usage: 0x0001 },
];

type RpcHandlers = Record<string, (params: unknown) => unknown>;

/** FakeHidDevice that answers RPC requests like device firmware would. */
class RespondingDevice extends FakeHidDevice {
  handlers: RpcHandlers = {};

  override sendReport(reportId: number, data: Uint8Array): Promise<void> {
    const result = super.sendReport(reportId, data);
    const { payload } = decodeFrame(data);
    const message = JSON.parse(new TextDecoder().decode(payload)) as {
      method?: string;
      id?: number;
    };
    if (typeof message.method === 'string' && typeof message.id === 'number') {
      const handler = this.handlers[message.method];
      queueMicrotask(() => {
        if (handler) this.emitRpc({ id: message.id, result: handler(message) });
        else this.emitRpc({ id: message.id, error: { code: -32601, message: 'Method not found' } });
      });
    }
    return result;
  }
}

function readyHandlers(): RpcHandlers {
  return {
    'sys.version': () => ({ version: 'v0.6.0' }),
    'device.status': () => ({ battery: 87, is_charging: false }),
    'v.oai.thstatus': () => ({ ok: 1 }),
    'fs.read': () => ({ data: CODEX_KEYMAP }),
  };
}

function makeSetup(
  deviceCount = 1,
  primaryCollections?: readonly { usagePage: number; usage: number }[],
): {
  hid: FakeWebHidApi;
  manager: HardwareConsoleManager;
  device: RespondingDevice;
} {
  const hid = new FakeWebHidApi();
  const device = new RespondingDevice(
    CM2.vendorId,
    CM2.productId,
    'Fake Device',
    primaryCollections,
  );
  device.handlers = readyHandlers();
  hid.devices = [device];
  for (let i = 1; i < deviceCount; i++) {
    hid.devices.push(
      new FakeHidDevice(CM2.vendorId, CM2.productId, 'Sibling', [SIBLING_PAIRS[i - 1]]),
    );
  }
  const manager = new HardwareConsoleManager(createWebHidPlatform(hid), {
    requestTimeoutMs: 200,
  });
  installHardwareConsoleConnectionToasts(manager);
  return { hid, manager, device };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('installHardwareConsoleConnectionToasts', () => {
  it('shows a connect toast with name, transport, firmware, and battery', async () => {
    const { manager } = makeSetup(6);
    await manager.start();
    await flushMicrotasks(20);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastSuccessMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(title).toContain('Creator Micro 2');
    expect(title).toContain('USB');
    expect(options.description).toContain('v0.6.0');
    expect(options.description).toContain('87');
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it('includes a Configure action that opens the hardware settings section', async () => {
    const { manager } = makeSetup();
    await manager.start();
    await flushMicrotasks(20);
    const [, options] = toastSuccessMock.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(options.action.label).toBe('Configure');
    expect(navigateToRouteMock).not.toHaveBeenCalled();
    options.action.onClick();
    await flushMicrotasks(20);
    expect(navigateToRouteMock).toHaveBeenCalledWith('/settings?tab=general#hardware');
  });

  it('shows the connect toast with the action on hotplug too', async () => {
    const { hid, manager, device } = makeSetup();
    hid.devices = [];
    await manager.start();
    await flushMicrotasks(20);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    hid.devices = [device];
    hid.emitConnect(device);
    await flushMicrotasks(20);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [, options] = toastSuccessMock.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(options.action.label).toBe('Configure');
  });

  it('labels Bluetooth from the 4-collection enumeration', async () => {
    const { manager } = makeSetup(4);
    await manager.start();
    await flushMicrotasks(20);
    const [title] = toastSuccessMock.mock.calls[0] as [string];
    expect(title).toContain('Bluetooth');
  });

  it('labels USB when macOS coalesces the enumeration into one device', async () => {
    // Regression (intent-hq/monorepo#1422): one granted device carrying all
    // 6 usage pairs used to count as 1 collection and label Bluetooth.
    const { manager } = makeSetup(1, USB_COALESCED_PAIRS);
    await manager.start();
    await flushMicrotasks(20);
    const [title] = toastSuccessMock.mock.calls[0] as [string];
    expect(title).toContain('USB');
  });

  it('warns when firmware lacks Codex support', async () => {
    const { manager, device } = makeSetup();
    delete device.handlers['v.oai.thstatus'];
    await manager.start();
    await flushMicrotasks(20);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    const [warning] = toastWarningMock.mock.calls[0] as [string];
    expect(warning).toContain('Creator Micro 2');
  });

  it('warns when the keymap has no Codex layer', async () => {
    const { manager, device } = makeSetup();
    device.handlers['fs.read'] = () => ({ data: JSON.stringify({ layers: [['KC_A']] }) });
    await manager.start();
    await flushMicrotasks(20);
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
  });

  it('shows a disconnect toast only after a connection existed', async () => {
    const { hid, manager, device } = makeSetup();
    await manager.start();
    await flushMicrotasks(20);
    hid.emitDisconnect(device);
    await flushMicrotasks(20);
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    const [title] = toastInfoMock.mock.calls[0] as [string];
    expect(title).toContain('Creator Micro 2');
    hid.emitDisconnect(device);
    await flushMicrotasks(20);
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });
});
