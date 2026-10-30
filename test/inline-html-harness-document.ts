import type { Plugin } from 'vite';

export const INLINE_HTML_HARNESS_DOCUMENT = '__inline-html-harness';

export function inlineHtmlHarnessDocument(): Plugin {
  return {
    name: 'inline-html-harness-document',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `/${INLINE_HTML_HARNESS_DOCUMENT}`) return next();
        // Serve a real document with Vite's client. SvelteKit's raw app template
        // route returns an error page without the optimizer reload connection.
        void server
          .transformIndexHtml(
            `/${INLINE_HTML_HARNESS_DOCUMENT}`,
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Inline visual harness</title></head><body></body></html>',
          )
          .then((html) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(html);
          }, next);
      });
    },
  };
}
