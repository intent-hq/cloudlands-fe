import { describe, expect, it } from 'vitest';
import { workspaceSetupScriptText } from './workspace-setup-script';

describe('workspaceSetupScriptText', () => {
  it('reads the script off the wire SetupScript record (PROTOCOL §5.25)', () => {
    expect(
      workspaceSetupScriptText({
        script: 'pnpm install',
        updatedAt: 1_700_000_000_000,
        generatedBy: 'agent',
      }),
    ).toBe('pnpm install');
  });

  it('passes a legacy bare-string script through', () => {
    expect(workspaceSetupScriptText('echo legacy')).toBe('echo legacy');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['record with an empty script', { script: '' }],
    ['record without a script', {} as { script: string }],
  ])('yields undefined for %s', (_label, value) => {
    expect(workspaceSetupScriptText(value)).toBeUndefined();
  });
});
