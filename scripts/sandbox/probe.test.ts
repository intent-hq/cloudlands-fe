// @vitest-environment node
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { formatProbeOutput, parseProbeArgs, shapeProbeOutput } from './probe.mjs';

describe('sandbox probe output', () => {
  it('parses the probe selector alongside shared runner options', () => {
    expect(
      parseProbeArgs([
        'button',
        '--state',
        'loading',
        '--theme',
        'dark',
        '--selector',
        '[data-probe="label"]',
        '--out',
        'geometry.json',
      ]),
    ).toMatchObject({
      scene: 'button',
      state: 'loading',
      theme: 'dark',
      selector: '[data-probe="label"]',
      out: 'geometry.json',
    });
  });

  it.each([
    { args: ['button', '--state', 'loading', '--selector'], message: /requires a value/ },
    {
      args: ['button', '--state', 'loading', '--selector', '.one', '--selector', '.two'],
      message: /only be specified once/,
    },
  ])('rejects an invalid selector option: $args', ({ args, message }) => {
    expect(() => parseProbeArgs(args)).toThrow(message);
  });

  it('shapes browser geometry as deterministic pretty JSON', () => {
    const output = shapeProbeOutput(
      { theme: 'light' },
      {
        slug: 'button',
        state: 'default',
        width: 420,
        root: { width: 96, height: 32 },
        probes: { 'data-probe=label': { x: 8, y: 6, width: 80, height: 20 } },
      },
    );

    expect(formatProbeOutput(output)).toBe(
      [
        '{',
        '  "scene": "button",',
        '  "state": "default",',
        '  "theme": "light",',
        '  "width": 420,',
        '  "root": {',
        '    "width": 96,',
        '    "height": 32',
        '  },',
        '  "probes": {',
        '    "data-probe=label": {',
        '      "x": 8,',
        '      "y": 6,',
        '      "width": 80,',
        '      "height": 20',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });
});
