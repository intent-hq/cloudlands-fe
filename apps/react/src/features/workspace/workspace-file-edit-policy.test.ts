import { expect, it } from 'vitest';
import { canEditWorkspaceText } from './workspace-file-edit-policy';
it('keeps BOM, empty, LF and CRLF text eligible without admitting mixed or lone CR endings', () => {
  for (const value of ['', '\uFEFFé\r\nsecond\r\n', 'one\ntwo\n'])
    expect(canEditWorkspaceText(value)).toBe(true);
  for (const value of ['one\r\ntwo\n', 'one\rtwo', 'é'.repeat(256001)])
    expect(canEditWorkspaceText(value)).toBe(false);
});
