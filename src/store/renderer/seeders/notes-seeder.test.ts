import { beforeEach, describe, expect, it } from 'vitest';
import { clearMockSeeders, getRegisteredMockSeeders } from '../mock-bootstrap';

describe('notes-seeder', () => {
  beforeEach(() => clearMockSeeders());

  it('leaves note, task, and comment hydration to root-owned sagas', async () => {
    await import('./index');

    expect(getRegisteredMockSeeders()).not.toContain('notes');
  });
});
