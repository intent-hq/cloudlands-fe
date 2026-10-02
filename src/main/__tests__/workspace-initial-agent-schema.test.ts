import { describe, expect, it } from 'vitest';
import { WorkspaceCreateSchema } from '../ipc-schemas';

describe('workspace initial agent provenance', () => {
  it('preserves manual memory and generated-name flags through the IPC schema', () => {
    const initialAgent = {
      name: 'Implementor',
      nameExplicitlySet: false,
      rememberSpecialist: true,
      specialist: 'implementor',
      provider: 'codex',
      model: 'gpt-6-astra',
    };
    expect(WorkspaceCreateSchema.parse({ initialAgent }).initialAgent).toEqual(initialAgent);
  });

  it('keeps explicit custom name provenance and legacy omissions intact', () => {
    const initialAgent = { name: 'My review', nameExplicitlySet: true };
    expect(WorkspaceCreateSchema.parse({ initialAgent }).initialAgent).toEqual(initialAgent);
    expect(
      WorkspaceCreateSchema.parse({ initialAgent: { name: 'Legacy name' } }).initialAgent,
    ).toEqual({ name: 'Legacy name' });
  });
});
