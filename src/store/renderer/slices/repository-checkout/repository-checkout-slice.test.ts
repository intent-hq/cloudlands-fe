import { describe, expect, it } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  repositoryCheckoutReducer as reduce,
  opened,
  checkoutBound,
  projectSelected,
  checkoutBranchResolutionChanged,
  modeChanged,
  checkoutUnavailable,
} from './repository-checkout-slice';

function captured() {
  return reduce(
    reduce(undefined, opened('form')),
    checkoutBound('form', 'scope', 'admission', {
      checkoutId: 'lease',
      revision: 'account',
      provider: 'gitlab',
      instanceBaseUrl: 'https://gitlab.example',
      expiresAfterMs: 1000,
    }),
  );
}
const form = (state: ReturnType<typeof reduce>) => getItem(state.forms, 'form')!;

describe('checkout branch resolution presentation', () => {
  it('ignores completion from another capture, project or branch revision', () => {
    let state = reduce(captured(), projectSelected('form', 'scope', 'team/app'));
    const projectRevision = form(state).projectRevision;
    const branchesRevision = form(state).branchesRevision;
    state = reduce(
      state,
      checkoutBranchResolutionChanged('form', 'scope', projectRevision, branchesRevision, true),
    );
    expect(form(state).resolvingBranch).toBe(true);
    for (const action of [
      checkoutBranchResolutionChanged(
        'form',
        'old-scope',
        projectRevision,
        branchesRevision,
        false,
      ),
      checkoutBranchResolutionChanged(
        'form',
        'scope',
        projectRevision - 1,
        branchesRevision,
        false,
      ),
      checkoutBranchResolutionChanged(
        'form',
        'scope',
        projectRevision,
        branchesRevision - 1,
        false,
      ),
    ])
      expect(reduce(state, action)).toEqual(state);
    state = reduce(state, modeChanged('form', 'scope', 'direct'));
    state = reduce(
      state,
      checkoutBranchResolutionChanged(
        'form',
        'scope',
        projectRevision,
        form(state).branchesRevision,
        true,
      ),
    );
    state = reduce(
      state,
      checkoutBranchResolutionChanged('form', 'scope', projectRevision, branchesRevision, false),
    );
    expect(form(state).resolvingBranch).toBe(true);
    state = reduce(
      state,
      checkoutBranchResolutionChanged(
        'form',
        'scope',
        projectRevision,
        form(state).branchesRevision,
        false,
      ),
    );
    expect(form(state).resolvingBranch).toBe(false);
  });

  it('clears pending presentation on retirement and rejects a late start', () => {
    let state = reduce(captured(), checkoutBranchResolutionChanged('form', 'scope', 0, 0, true));
    state = reduce(
      state,
      checkoutUnavailable('form', 'scope', { status: 'unavailable', reason: 'retired' }),
    );
    expect(form(state).resolvingBranch).toBe(false);
    expect(
      reduce(
        state,
        checkoutBranchResolutionChanged(
          'form',
          'scope',
          form(state).projectRevision,
          form(state).branchesRevision,
          true,
        ),
      ),
    ).toEqual(state);
  });
});
