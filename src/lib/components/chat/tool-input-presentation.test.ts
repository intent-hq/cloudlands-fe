import { describe, expect, it } from 'vitest';
import { getToolInputEntries } from './tool-input-presentation';
import { sanitizeToolPayload } from './tool-display-model';
describe('shared source ToolDetails input eligibility', () => {
  it('omits featured/internal/null/empty values but preserves false and zero', () => {
    expect(
      getToolInputEntries({ _acpTitle: 'Read', query: 'needle', empty: '', none: null, list: [] }),
    ).toBeNull();
    expect(getToolInputEntries({ enabled: false, line: 0, path: 'greeting.txt' })).toEqual([
      { key: 'enabled', value: 'false' },
      { key: 'line', value: '0' },
      { key: 'path', value: 'greeting.txt' },
    ]);
  });
  it('keeps the original source sanitization and 150 character summary boundary', () => {
    expect(
      getToolInputEntries(
        sanitizeToolPayload({ code: 'x'.repeat(151), args: ['a', 2] }) as Record<string, unknown>,
      ),
    ).toEqual([
      { key: 'code', value: 'x'.repeat(150) + '…' },
      { key: 'args', value: 'a, 2' },
    ]);
  });
});
