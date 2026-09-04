// @vitest-environment node
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { buildSandboxUrl, parseSandboxArgs } from './runner.mjs';

describe('sandbox runner arguments', () => {
  it('applies deterministic capture defaults', () => {
    expect(parseSandboxArgs(['button', '--state', 'loading'])).toEqual({
      scene: 'button',
      state: 'loading',
      theme: 'light',
      motion: 'reduced',
      width: 720,
      scale: 1,
      timeout: 30_000,
      allowConsoleErrors: false,
    });
  });

  it('parses all supported overrides', () => {
    expect(
      parseSandboxArgs([
        'button',
        '--state',
        'loading',
        '--theme',
        'system',
        '--width',
        '420',
        '--motion',
        'full',
        '--scale',
        '2',
        '--base-url',
        'http://127.0.0.1:5173',
        '--out',
        'capture.png',
        '--timeout',
        '5000',
        '--allow-console-errors',
      ]),
    ).toMatchObject({
      scene: 'button',
      state: 'loading',
      theme: 'system',
      width: 420,
      motion: 'full',
      scale: 2,
      baseUrl: 'http://127.0.0.1:5173/',
      out: 'capture.png',
      timeout: 5000,
      allowConsoleErrors: true,
    });
  });

  it.each([
    { args: [], message: /scene is required/ },
    { args: ['button'], message: /--state is required/ },
    { args: ['button', '--state', 'loading', '--width', '200'], message: /240 to 1600/ },
    { args: ['button', '--state', 'loading', '--scale', '3'], message: /1 to 2/ },
    { args: ['button', '--state', 'loading', '--theme', 'sepia'], message: /light, dark/ },
    { args: ['button', '--state', 'loading', '--wat'], message: /Unknown option/ },
  ])('rejects invalid input: $args', ({ args, message }) => {
    expect(() => parseSandboxArgs(args)).toThrow(message);
  });
});

describe('buildSandboxUrl', () => {
  it('builds the component-fit preview URL under a base path', () => {
    const options = parseSandboxArgs(['workspace card', '--state', 'wide', '--width', '720']);
    expect(buildSandboxUrl('http://localhost:5173/root', options)).toBe(
      'http://localhost:5173/root/sandbox/workspace%20card?state=wide&theme=light&width=720&motion=reduced&fit=component',
    );
  });
});
