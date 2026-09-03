import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hardenProductionScriptCsp, injectParaglideBundle } from './fix-production-html-utils.mjs';

describe('production HTML transforms', () => {
  it('injects the generated Paraglide bundle before application scripts', () => {
    const html = injectParaglideBundle(
      '<html><head></head><body><script>boot()</script></body></html>',
    );
    expect(html).toContain('<script src="/generated/paraglide.js"></script>\n</head>');
    expect(html.indexOf('paraglide.js')).toBeLessThan(html.indexOf('boot()'));
  });

  it('resolves the generated bundle from the renderer root on deep routes', () => {
    const html = injectParaglideBundle('<html><head></head><body></body></html>');
    const src = html.match(/<script src="([^"]*paraglide\.js)"><\/script>/)?.[1];
    expect(new URL(src!, 'https://intent.example/workspace/abc')).toHaveProperty(
      'pathname',
      '/generated/paraglide.js',
    );
  });

  it('is idempotent', () => {
    const once = injectParaglideBundle('<html><head></head><body></body></html>');
    expect(injectParaglideBundle(once)).toBe(once);
  });

  it('hashes inline scripts and removes unsafe production script allowances', () => {
    const inlineScript = 'boot()';
    const hash = createHash('sha256').update(inlineScript, 'utf8').digest('base64');
    const html = hardenProductionScriptCsp(
      `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; media-src 'self' data: blob: https: workspace-asset: workspace-file:;" /></head><body><script>${inlineScript}</script><script src="/app.js"></script></body></html>`,
    );

    expect(html).toContain(`script-src 'self' 'sha256-${hash}'`);
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
    expect(html).toContain("style-src 'self' 'unsafe-inline'");
    expect(html).toContain("media-src 'self' data: blob: https: workspace-asset: workspace-file:;");
  });

  it('fails closed when production HTML has no CSP', () => {
    expect(() => hardenProductionScriptCsp('<html><script>boot()</script></html>')).toThrow(
      'Content-Security-Policy',
    );
  });
});
