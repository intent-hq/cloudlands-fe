/** Fixture MCP client: use only the parent agent's daemon-provided bridge. */
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export async function createMockChild(servers, child) {
  const matches = servers.filter((server) => server.name === 'workspace-mcp');
  if (
    matches.length !== 1 ||
    typeof matches[0].command !== 'string' ||
    !Array.isArray(matches[0].args)
  ) {
    throw new Error('Missing unique daemon-provided workspace MCP stdio bridge');
  }
  const server = matches[0];
  const env = {
    ...process.env,
    ...Object.fromEntries((server.env ?? []).map(({ name, value }) => [name, value])),
  };
  const proc = spawn(server.command, server.args, { env, stdio: ['pipe', 'pipe', 'inherit'] });
  let pending;
  let nextId = 0;
  let bytes = 0;
  const closed = new Promise((resolve) => proc.once('close', resolve));
  const lines = readline.createInterface({ input: proc.stdout });
  const fail = (error) => pending?.reject(error);
  proc.on('error', fail);
  proc.stdin.on('error', fail);
  proc.on('close', () => fail(new Error('MCP bridge closed before its response')));
  lines.on('line', (line) => {
    bytes += Buffer.byteLength(line);
    try {
      if (bytes > 1024 * 1024) throw new Error('MCP fixture response exceeds 1 MiB');
      const message = JSON.parse(line);
      if (message.id === pending?.id) {
        if (message.error) throw new Error(JSON.stringify(message.error));
        pending.resolve(message.result);
      }
    } catch (error) {
      fail(error);
    }
  });
  const request = async (method, params) => {
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        pending = { id: ++nextId, resolve, reject };
        timer = setTimeout(() => reject(new Error(`MCP ${method} exceeded 30s`)), 30_000);
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params }) + '\n');
      });
    } finally {
      clearTimeout(timer);
      pending = undefined;
    }
  };
  let primary;
  try {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'packaged-smoke', version: '1' },
    });
    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    const result = await request('tools/call', {
      name: 'workspace_api',
      arguments: {
        code: `return await ws.agent.create(${JSON.stringify(child.name)}, ${JSON.stringify(child.prompt)}, { provider: "mock", skipAutoCommit: true });`,
        summary: 'Create packaged smoke fixture child',
      },
    });
    if (result.isError) throw new Error(JSON.stringify(result));
    return result;
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    proc.stdin.end();
    const wait = async (milliseconds) => {
      let timer;
      try {
        return await Promise.race([
          closed.then(() => true),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), milliseconds);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    if (!(await wait(2_000))) {
      proc.kill('SIGTERM');
      if (!(await wait(2_000))) {
        proc.kill('SIGKILL');
        if (!(await wait(2_000)))
          throw new AggregateError(
            [primary, new Error('MCP bridge settlement unknown')].filter(Boolean),
          );
      }
    }
    lines.close();
  }
}
