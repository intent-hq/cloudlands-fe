import { describe, expect, it } from 'vitest';
import { toolbarCollapseState } from './toolbar-collapse';

describe('toolbarCollapseState', () => {
  it.each([
    [240, 'controls-collapsed'],
    [399, 'controls-collapsed'],
    [400, 'hostname-hidden'],
    [559, 'hostname-hidden'],
    [560, 'full'],
  ] as const)('classifies a %ipx toolbar as %s', (width, expected) => {
    expect(toolbarCollapseState(width)).toBe(expected);
  });
});
