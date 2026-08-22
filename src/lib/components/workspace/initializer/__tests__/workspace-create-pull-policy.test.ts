import { describe, expect, it } from 'vitest';
import { shouldPullSourceRepositoryBeforeCreate } from '../workspace-create-pull-policy';

const directLocalCreate = {
  branchBehind: 2,
  isLocalRepository: true,
  isNewRepository: false,
  skipIsolation: true,
  pullEnabled: true,
};

describe('workspace create pull policy', () => {
  it('does not mutate the source checkout for an isolated workspace', () => {
    expect(
      shouldPullSourceRepositoryBeforeCreate({ ...directLocalCreate, skipIsolation: false }),
    ).toBe(false);
  });

  it('pulls a behind branch before direct workspace creation', () => {
    expect(shouldPullSourceRepositoryBeforeCreate(directLocalCreate)).toBe(true);
  });

  it.each([
    { branchBehind: 0 },
    { isLocalRepository: false },
    { isNewRepository: true },
    { pullEnabled: false },
  ])('does not pull when the remaining precondition is false: %o', (override) => {
    expect(shouldPullSourceRepositoryBeforeCreate({ ...directLocalCreate, ...override })).toBe(
      false,
    );
  });
});
