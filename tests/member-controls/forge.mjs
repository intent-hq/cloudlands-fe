// Synthetic public proof records only. Daemon RPC/auth responses are never mocked.
import { createServer } from 'node:http';
import { once } from 'node:events';
export async function forgeFixture(record) {
  const proofs = new Map();
  const users = { member: { id: 9001, login: 'member' }, guest: { id: 9002, login: 'guest' } };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    record({ kind: 'synthetic-forge-request', method: req.method, path });
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    const user = users[path.replace('/users/', '')];
    const proof = proofs.get(path.replace('/gists/', ''));
    const result = path.startsWith('/users/') ? user : path.startsWith('/gists/') ? proof : null;
    res.setHeader('content-type', 'application/json');
    res.writeHead(result ? 200 : 404);
    res.end(JSON.stringify(result ?? { message: 'Not Found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    prove(role, nonce) {
      const user = users[role];
      if (!user || typeof nonce !== 'string') throw new Error('unknown synthetic proof subject');
      const id = `fixture-${role}`;
      proofs.set(id, {
        owner: user,
        created_at: new Date().toISOString(),
        files: {
          'intent-join-proof.txt': {
            filename: 'intent-join-proof.txt',
            content: nonce,
            truncated: false,
          },
        },
      });
      return { provider: 'github', host: 'github.com', gistId: id, login: user.login };
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      proofs.clear();
    },
  };
}
