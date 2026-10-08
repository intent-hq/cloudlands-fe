import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('PORT must be an integer from 1024 to 65535');
}

const routes = new Map([
  ['/', [new URL('./index.html', import.meta.url), 'text/html']],
  ['/app.js', [new URL('./app.js', import.meta.url), 'text/javascript']],
  ['/style.css', [new URL('./style.css', import.meta.url), 'text/css']],
  ...['index', 'protocol', 'tokens'].map((name) => [
    `/sdk/${name}.js`,
    [new URL(`../../sdk/custom-view/dist/${name}.js`, import.meta.url), 'text/javascript'],
  ]),
]);

const server = createServer(async (request, response) => {
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  const route = routes.get(path);
  if (!route || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(route[0]);
    response.writeHead(200, {
      'Content-Type': `${route[1]}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500).end('Run corepack pnpm run build:custom-view-sdk first.');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Custom view theme example: http://127.0.0.1:${port}/`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close());
}
