// @verify-changed-triggers: src/app.html

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { hardenProductionScriptCsp } from '../../../scripts/fix-production-html-utils.mjs';

const appHtml = fs.readFileSync(path.resolve(__dirname, '../../app.html'), 'utf8');

function cspDirective(html: string, name: string): string | undefined {
  const content = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  expect(content).toBeDefined();
  return content!
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
}

describe('renderer Content Security Policy', () => {
  it('loads same-origin runtime configuration before application bootstraps', () => {
    const runtimeConfigTag = '<script src="/runtime-config.js"></script>';
    expect(appHtml).toContain(runtimeConfigTag);
    expect(appHtml.indexOf(runtimeConfigTag)).toBeLessThan(appHtml.indexOf('<script>'));
  });

  it('does not load the remote Figma capture script', () => {
    expect(appHtml).not.toContain('mcp.figma.com');
    expect(appHtml).not.toContain('html-to-design/capture.js');
  });

  it('does not allow remote or blob-backed scripts', () => {
    const content = appHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
    const scriptSrc = content!
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('script-src '));

    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it('limits renderer connections to secure transports, local development and workspace media downloads', () => {
    const content = appHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
    expect(content).toBeDefined();

    const connectSrc = content!
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('connect-src '));
    expect(connectSrc).toBe(
      "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* workspace-file: workspace-asset:",
    );
  });

  it('allows same-origin and inlined data: fonts', () => {
    expect(cspDirective(appHtml, 'font-src')).toBe("font-src 'self' data:");
  });

  it('keeps font-src in the production-hardened CSP while still dropping unsafe-eval', () => {
    const hardened = hardenProductionScriptCsp(appHtml);
    expect(cspDirective(hardened, 'font-src')).toBe("font-src 'self' data:");
    expect(cspDirective(hardened, 'script-src')).not.toContain("'unsafe-eval'");
    expect(cspDirective(hardened, 'script-src')).not.toContain("'unsafe-inline'");
  });
});
