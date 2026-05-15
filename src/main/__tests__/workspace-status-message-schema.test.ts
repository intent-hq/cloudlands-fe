import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  WorkspaceCreateSchema,
  WorkspaceUpdateSchema,
} from '../ipc-schemas';
import { WORKSPACE_STATUS_MESSAGE_MAX_LENGTH } from '../../shared/types';

describe('workspace status message IPC schemas', () => {
  it('accept statusMessage on workspace create and update requests', () => {
    const statusMessage = 'Implementing the shared data model.';

    expect(WorkspaceCreateSchema.parse({ title: 'Status Test', statusMessage })).toMatchObject({
      statusMessage,
    });
    expect(WorkspaceUpdateSchema.parse({ id: 'amber-forest', statusMessage })).toMatchObject({
      statusMessage,
    });
  });

  it('reject overly long statusMessage values', () => {
    const statusMessage = 'x'.repeat(WORKSPACE_STATUS_MESSAGE_MAX_LENGTH + 1);

    expect(() => WorkspaceCreateSchema.parse({ statusMessage })).toThrow();
    expect(() => WorkspaceUpdateSchema.parse({ id: 'amber-forest', statusMessage })).toThrow();
  });
});
