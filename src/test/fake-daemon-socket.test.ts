// @vitest-environment node
// @verify-changed-triggers: scripts/hello-capabilities-fixtures.mjs, tests/fixtures/hello-capabilities.json, tests/fixtures/hello-capabilities.lock.json
import { describe, expect, it } from 'vitest';
import { hostExecutionContextSchema } from '$shared/types/host-execution';
import { loadHelloCapabilities } from '../../scripts/hello-capabilities-fixtures.mjs';
import { createFakeDaemon } from './fake-daemon-socket';

type Socket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  send(data: string): void;
};

async function request(method: string) {
  const daemon = createFakeDaemon();
  const socket = new daemon.Socket('ws://fake') as Socket;
  await new Promise<void>((resolve) => (socket.onopen = resolve));
  const reply = new Promise<{ result?: unknown; error?: unknown }>(
    (resolve) => (socket.onmessage = (event) => resolve(JSON.parse(event.data))),
  );
  socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }));
  return reply;
}

describe('fake daemon defaults', () => {
  it('announces exactly the regular profile of the locked capability golden', async () => {
    const { profiles } = (await loadHelloCapabilities()) as {
      profiles: { id: string; daemonMode: string; capabilities: Record<string, unknown> }[];
    };
    const regular = profiles.find((profile) => profile.id === 'regular')!;
    const { result } = (await request('client.hello')) as {
      result: { server: { daemonMode: string; capabilities: Record<string, unknown> } };
    };
    expect(result.server.capabilities).toStrictEqual(regular.capabilities);
    expect(result.server.daemonMode).toBe(regular.daemonMode);
  });

  it('answers host.executionContext with a reply the renderer accepts, so it never retries', async () => {
    const { result } = await request('host.executionContext');
    expect(hostExecutionContextSchema.safeParse(result).success).toBe(true);
  });
});
