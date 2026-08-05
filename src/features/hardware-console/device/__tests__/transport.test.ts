import { describe, expect, it, vi } from 'vitest';

import { buildThStatusParams } from '../../led/frames';
import { CHANNEL_LOG, CHANNEL_RPC, MAX_PAYLOAD, REPORT_ID } from '../frame';
import { HardwareRpcClient } from '../rpc-client';
import { VendorChannelTransport } from '../transport';
import { FakeHidDevice, flushMicrotasks } from './fake-hid';

const encoder = new TextEncoder();

function toHex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function makeTransport(): { device: FakeHidDevice; transport: VendorChannelTransport } {
  const device = new FakeHidDevice(0x303a, 0x8297);
  const transport = new VendorChannelTransport(device);
  transport.attach();
  return { device, transport };
}

describe('VendorChannelTransport (outbound)', () => {
  it('sends a short RPC message as one report-6 packet', async () => {
    const { device, transport } = makeTransport();
    await transport.sendRpcMessage({ id: 1, method: 'sys.version', params: null });
    expect(device.sentReports).toHaveLength(1);
    const { reportId, data } = device.sentReports[0];
    expect(reportId).toBe(REPORT_ID);
    expect(data[0]).toBe(CHANNEL_RPC);
    const len = data[1];
    expect(new TextDecoder().decode(data.slice(2, 2 + len))).toBe(
      '{"id":1,"method":"sys.version","params":null}',
    );
  });

  it('fragments large RPC messages across packets', async () => {
    const { device, transport } = makeTransport();
    const message = { method: 'x', params: { blob: 'z'.repeat(150) }, id: 2 };
    await transport.sendRpcMessage(message);
    const expectedBytes = encoder.encode(JSON.stringify(message)).length;
    expect(device.sentReports.length).toBe(Math.ceil(expectedBytes / MAX_PAYLOAD));
    const total = device.sentReports.reduce((sum, r) => sum + r.data[1], 0);
    expect(total).toBe(expectedBytes);
  });

  it('frames a full v.oai.thstatus request exactly like cm2-probe (multi-packet regression)', async () => {
    // Live-hardware regression: a full 6-entry thstatus frame spans multiple
    // report-6 packets. The envelope keys (id, method) MUST be serialized
    // first so they land in the first 61-byte fragment — the cm2-probe wire
    // order (serde_json alphabetical keys). With `id` last the firmware
    // rejects the send with {"code":400,"message":"Missing method"}.
    const { device, transport } = makeTransport();
    const client = new HardwareRpcClient(
      { sendMessage: (message) => transport.sendRpcMessage(message) },
      { requestTimeoutMs: 50 },
    );
    // Slots 5–6 (indexes 4–5) drive LED ids 0 and 1 (SLOT_TO_LED_ID), so
    // this frame keeps the exact cm2-probe byte regression below: id 0 =
    // idle, id 1 = running, ids 2–5 off.
    const params = buildThStatusParams([
      'unassigned',
      'unassigned',
      'unassigned',
      'unassigned',
      'idle',
      'running',
    ]);
    const pending = client.call('v.oai.thstatus', params);
    await flushMicrotasks();
    const json = JSON.stringify({ id: 1, method: 'v.oai.thstatus', params });
    expect(json.length).toBeGreaterThan(MAX_PAYLOAD);
    // Exact packet bytes, derived from cm2-probe's frame::encode for the
    // same message (63-byte report bodies; WebHID carries reportId=6 out of
    // band): [channel=2][len][payload…][zero padding].
    expect(device.sentReports.map((r) => toHex(r.data))).toEqual([
      '023d7b226964223a312c226d6574686f64223a22762e6f61692e7468737461747573222c22706172616d73223a5b7b226964223a302c2263223a3136373737',
      '023d3231352c2262223a302e31322c2265223a312c2273223a307d2c7b226964223a312c2263223a3638393430372c2262223a302e362c2265223a342c2273',
      '023d223a302e357d2c7b226964223a322c2263223a302c2262223a302c2265223a302c2273223a307d2c7b226964223a332c2263223a302c2262223a302c22',
      '023d65223a302c2273223a307d2c7b226964223a342c2263223a302c2262223a302c2265223a302c2273223a307d2c7b226964223a352c2263223a302c2262',
      '0212223a302c2265223a302c2273223a307d5d7d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    ]);
    // Every report targets report ID 6.
    expect(device.sentReports.every((r) => r.reportId === REPORT_ID)).toBe(true);
    // The envelope ({"id":1,"method":"v.oai.thstatus"…) is fully inside the
    // first fragment.
    const first = device.sentReports[0];
    const firstPayload = new TextDecoder().decode(first.data.slice(2, 2 + first.data[1]));
    expect(firstPayload.startsWith('{"id":1,"method":"v.oai.thstatus","params":[')).toBe(true);
    client.handleMessage({ id: 1, result: { ok: 1 } });
    await expect(pending).resolves.toEqual({ ok: 1 });
  });

  it('does not interleave fragments from concurrent sends', async () => {
    const { device, transport } = makeTransport();
    const big = { id: 1, result: { blob: 'a'.repeat(120) } };
    const small = { id: 2, result: null };
    await Promise.all([transport.sendRpcMessage(big), transport.sendRpcMessage(small)]);
    const rejoined = device.sentReports
      .map((r) => new TextDecoder().decode(r.data.slice(2, 2 + r.data[1])))
      .join('');
    expect(rejoined).toBe(JSON.stringify(big) + JSON.stringify(small));
  });
});

describe('VendorChannelTransport (inbound)', () => {
  it('demuxes channel 1 to log listeners', () => {
    const { device, transport } = makeTransport();
    const logs: string[] = [];
    transport.onLog((text) => logs.push(text));
    device.emitMessage(CHANNEL_LOG, encoder.encode('boot ok\n'));
    expect(logs).toEqual(['boot ok\n']);
  });

  it('reassembles fragmented channel-2 JSON before notifying', () => {
    const { device, transport } = makeTransport();
    const messages: unknown[] = [];
    transport.onRpcMessage((m) => messages.push(m));
    const payload = { id: 9, result: { data: 'k'.repeat(200) } };
    device.emitRpc(payload);
    expect(messages).toEqual([payload]);
  });

  it('ignores reports with other report IDs', () => {
    const { device, transport } = makeTransport();
    const messages: unknown[] = [];
    transport.onRpcMessage((m) => messages.push(m));
    device.emitReport(new Uint8Array(63), 1);
    expect(messages).toEqual([]);
  });

  it('ignores frames on unknown channels', () => {
    const { device, transport } = makeTransport();
    const messages: unknown[] = [];
    const logs: string[] = [];
    transport.onRpcMessage((m) => messages.push(m));
    transport.onLog((t) => logs.push(t));
    const body = new Uint8Array(63);
    body[0] = 7;
    body[1] = 1;
    body[2] = 0x41;
    device.emitReport(body);
    expect(messages).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('stops delivering after detach and unsubscribe works', () => {
    const { device, transport } = makeTransport();
    const listener = vi.fn();
    const unsubscribe = transport.onRpcMessage(listener);
    device.emitRpc({ id: 1, result: null });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    device.emitRpc({ id: 2, result: null });
    expect(listener).toHaveBeenCalledTimes(1);
    transport.onRpcMessage(listener);
    transport.detach();
    device.emitRpc({ id: 3, result: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('continues sending after a sendReport failure', async () => {
    const { device, transport } = makeTransport();
    const original = device.sendReport.bind(device);
    let fail = true;
    device.sendReport = (reportId, data) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('device busy'));
      }
      return original(reportId, data);
    };
    await expect(transport.sendRpcMessage({ id: 1 })).rejects.toThrow('device busy');
    await transport.sendRpcMessage({ id: 2 });
    await flushMicrotasks();
    expect(device.sentReports).toHaveLength(1);
    expect(device.sentReports[0].data[1]).toBe('{"id":2}'.length);
  });
});
