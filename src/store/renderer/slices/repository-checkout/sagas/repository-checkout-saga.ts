import { eventChannel, buffers } from 'redux-saga';
import {
  call,
  cancelled,
  delay,
  fork,
  put,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import type {
  CheckoutResult,
  CheckoutUnavailable,
  RepositoryCheckoutSession,
} from '$shared/types/repository-checkout';
import type { RepositoryCheckoutForm } from '../repository-checkout-types';
import {
  selectCheckoutAdmission,
  selectCheckoutForm,
  selectCheckoutSelection,
} from '../repository-checkout-selectors';
import {
  opened,
  checkoutRepoConfigRequested,
  closed,
  invalidDraftOpened,
  projectQueryChanged,
  projectsMoreRequested,
  projectSelected,
  urlSubmitted,
  branchQueryChanged,
  branchesMoreRequested,
  branchSelected,
  modeChanged,
  recoveryRequested,
  checkoutBound,
  checkoutUnavailable,
  checkoutProjectsReceived,
  checkoutProjectReceived,
  checkoutBranchesReceived,
  checkoutBranchRestored,
  checkoutBranchResolutionChanged,
  checkoutWarmChanged,
} from '../repository-checkout-slice';

type Runtime = {
  formId: string;
  scopeKey: string;
  admission: string;
  dead: boolean;
  pending: Set<string>;
  session?: RepositoryCheckoutSession;
};
const retired: CheckoutUnavailable = { status: 'unavailable', reason: 'retired' };
const unreachable: CheckoutUnavailable = { status: 'unavailable', reason: 'unreachable' };

/** Root-owned workers never rebind an in-flight call to a newer session. */
export function* repositoryCheckoutSaga(): SagaGenerator<void> {
  const runtimes = new Map<string, Runtime>();
  function dispose(runtime: Runtime) {
    runtime.dead = true;
    if (runtimes.get(runtime.formId) === runtime) runtimes.delete(runtime.formId);
    void runtime.session?.release();
  }
  function* current(runtime: Runtime): SagaGenerator<RepositoryCheckoutForm | null> {
    if (
      runtime.dead ||
      runtimes.get(runtime.formId) !== runtime ||
      (yield* selectCheckoutAdmission.effect()) !== runtime.admission
    )
      return null;
    const form = yield* selectCheckoutForm.effect(runtime.formId);
    return form?.scopeKey === runtime.scopeKey && form.status === 'ready' ? form : null;
  }
  function* fail(runtime: Runtime, failure: CheckoutUnavailable): SagaGenerator<void> {
    if (yield* current(runtime))
      yield* put(checkoutUnavailable(runtime.formId, runtime.scopeKey, failure));
    dispose(runtime);
  }
  function* result<T>(runtime: Runtime, value: CheckoutResult<T>): SagaGenerator<T | null> {
    if (!(yield* current(runtime))) return null;
    if (value.status === 'unavailable') {
      yield* fail(runtime, value);
      return null;
    }
    return value.value;
  }
  function* authorityFailure(
    runtime: Runtime,
    value: CheckoutResult<unknown>,
  ): SagaGenerator<boolean> {
    if (
      value.status !== 'unavailable' ||
      !['disabled', 'not-connected', 'access-denied', 'retired'].includes(value.reason)
    )
      return false;
    yield* fail(runtime, value);
    return true;
  }
  function* warm(runtime: Runtime): SagaGenerator<void> {
    if (!(yield* current(runtime)) || !runtime.session) return;
    const selection = yield* selectCheckoutSelection.effect(runtime.formId);
    if (!selection || selection.mode !== 'cached') return;
    yield* put(checkoutWarmChanged(runtime.formId, runtime.scopeKey, selection, 'warming'));
    const stillSelected = function* (): SagaGenerator<boolean> {
      return (
        !!(yield* current(runtime)) &&
        JSON.stringify(yield* selectCheckoutSelection.effect(runtime.formId)) ===
          JSON.stringify(selection)
      );
    };
    try {
      const response = yield* call([runtime.session, runtime.session.warm], selection);
      if (yield* authorityFailure(runtime, response)) return;
      if (!(yield* stillSelected())) return;
      if (yield* result(runtime, response))
        yield* put(checkoutWarmChanged(runtime.formId, runtime.scopeKey, selection, 'ready'));
    } catch {
      if (yield* stillSelected()) yield* fail(runtime, unreachable);
    }
  }
  function* observeRetirement(runtime: Runtime): SagaGenerator<void> {
    const session = runtime.session;
    if (!session) return;
    const events = eventChannel<true>(
      (emit) => session.onRetired(() => emit(true)),
      buffers.sliding(1),
    );
    try {
      yield* take(events);
      yield* fail(runtime, retired);
    } finally {
      events.close();
    }
  }
  function* readProjects(runtime: Runtime, append: boolean, debounce = false): SagaGenerator<void> {
    const form = yield* current(runtime);
    if (!form || !runtime.session || form.projectsStatus !== 'loading') return;
    const revision = form.projectsRevision,
      cursor = append ? form.projectsCursor : null;
    const key = 'projects:' + revision;
    if (runtime.pending.has(key)) return;
    runtime.pending.add(key);
    try {
      if (debounce) yield* delay(200);
      if ((yield* current(runtime))?.projectsRevision !== revision) return;
      // URL entry is resolved explicitly by the user, never on partial keystrokes.
      if (/^https?:\/\//i.test(form.projectQuery.trim())) {
        yield* put(
          checkoutProjectsReceived(
            runtime.formId,
            runtime.scopeKey,
            revision,
            { items: [] },
            false,
          ),
        );
        return;
      }
      try {
        const response = yield* call([runtime.session, runtime.session.projects], {
          ...(form.projectQuery ? { query: form.projectQuery } : {}),
          ...(cursor ? { cursor } : {}),
          limit: 50,
        });
        if (yield* authorityFailure(runtime, response)) return;
        if ((yield* current(runtime))?.projectsRevision !== revision) return;
        const page = yield* result(runtime, response);
        if (!page) return;
        if (cursor && page.nextCursor === cursor) {
          yield* fail(runtime, unreachable);
          return;
        }
        yield* put(
          checkoutProjectsReceived(runtime.formId, runtime.scopeKey, revision, page, append),
        );
      } catch {
        if ((yield* current(runtime))?.projectsRevision === revision)
          yield* fail(runtime, unreachable);
      }
    } finally {
      runtime.pending.delete(key);
    }
  }
  function* readBranches(runtime: Runtime, append: boolean, debounce = false): SagaGenerator<void> {
    const form = yield* current(runtime);
    if (!form?.project || !runtime.session || form.branchesStatus !== 'loading') return;
    const revision = form.branchesRevision,
      projectRevision = form.projectRevision;
    const cursor = append ? form.branchesCursor : null;
    const key = 'branches:' + revision;
    if (runtime.pending.has(key)) return;
    runtime.pending.add(key);
    try {
      if (debounce) yield* delay(200);
      const stillCurrent = function* (): SagaGenerator<boolean> {
        const latest = yield* current(runtime);
        return latest?.branchesRevision === revision && latest.projectRevision === projectRevision;
      };
      if (!(yield* stillCurrent())) return;
      try {
        const response = yield* call([runtime.session, runtime.session.branches], {
          projectPath: form.project.projectPath,
          ...(form.branchQuery ? { query: form.branchQuery } : {}),
          ...(cursor ? { cursor } : {}),
          limit: 50,
          cached: form.mode === 'cached',
        });
        if (yield* authorityFailure(runtime, response)) return;
        if (!(yield* stillCurrent())) return;
        const page = yield* result(runtime, response);
        if (!page) return;
        if (cursor && page.nextCursor === cursor) {
          yield* fail(runtime, unreachable);
          return;
        }
        yield* put(
          checkoutBranchesReceived(
            runtime.formId,
            runtime.scopeKey,
            revision,
            projectRevision,
            page,
            append,
          ),
        );
      } catch {
        if (yield* stillCurrent()) yield* fail(runtime, unreachable);
      }
    } finally {
      runtime.pending.delete(key);
    }
  }
  function* readProject(runtime: Runtime): SagaGenerator<void> {
    const form = yield* current(runtime);
    if (!form?.projectRequest || !runtime.session) return;
    const revision = form.projectRevision,
      originalDraft = form.draft;
    let branchRevision = form.branchesRevision;
    yield* put(
      checkoutBranchResolutionChanged(
        runtime.formId,
        runtime.scopeKey,
        revision,
        branchRevision,
        true,
      ),
    );
    try {
      const response = yield* call([runtime.session, runtime.session.project], form.projectRequest);
      if (yield* authorityFailure(runtime, response)) return;
      if ((yield* current(runtime))?.projectRevision !== revision) return;
      const detail = yield* result(runtime, response);
      if (!detail) return;
      if (
        'projectPath' in form.projectRequest &&
        form.projectRequest.projectPath !== detail.project.projectPath
      ) {
        yield* fail(runtime, unreachable);
        return;
      }
      // The daemon resolves MR/issue URLs to their target project. No PR-head rewrite.
      yield* put(checkoutProjectReceived(runtime.formId, runtime.scopeKey, revision, detail));
      yield* put(branchQueryChanged(runtime.formId, runtime.scopeKey, ''));
      branchRevision = (yield* current(runtime))?.branchesRevision ?? branchRevision;
      yield* put(
        checkoutBranchResolutionChanged(
          runtime.formId,
          runtime.scopeKey,
          revision,
          branchRevision,
          true,
        ),
      );
      const desired =
        getItem(form.branchByProject, detail.project.projectPath)?.branch ??
        (originalDraft?.instanceBaseUrl === runtime.session.capture.instanceBaseUrl &&
        originalDraft.projectPath === detail.project.projectPath
          ? originalDraft.branch
          : undefined) ??
        detail.project.defaultBranch;
      if (!desired) return;
      // Resolve saved/default names through server search, including names beyond
      // page one. Missing branches remain unselected rather than becoming main.
      const searchForm = yield* current(runtime);
      const searchRevision = searchForm?.branchesRevision;
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const branchResult = yield* call([runtime.session, runtime.session.branches], {
          projectPath: detail.project.projectPath,
          query: desired,
          limit: 50,
          cached: searchForm?.mode === 'cached',
          ...(cursor ? { cursor } : {}),
        });
        if (yield* authorityFailure(runtime, branchResult)) return;
        const latest = yield* current(runtime);
        if (
          !latest ||
          latest.projectRevision !== revision ||
          latest.branchesRevision !== searchRevision ||
          latest.explicitBranch
        )
          return;
        const page = yield* result(runtime, branchResult);
        if (!page) return;
        const branch = page.items.find((item) => item.name === desired);
        if (branch) {
          yield* put(checkoutBranchRestored(runtime.formId, runtime.scopeKey, revision, branch));
          return;
        }
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) {
          yield* fail(runtime, unreachable);
          return;
        }
        if (cursor) seen.add(cursor);
      } while (cursor);
    } catch {
      if ((yield* current(runtime))?.projectRevision === revision)
        yield* fail(runtime, unreachable);
    } finally {
      yield* put(
        checkoutBranchResolutionChanged(
          runtime.formId,
          runtime.scopeKey,
          revision,
          branchRevision,
          false,
        ),
      );
    }
  }
  function* open(action: ReturnType<typeof opened>): SagaGenerator<void> {
    const [formId, draft] = action.payload;
    const old = runtimes.get(formId);
    if (old) dispose(old);
    const admission = yield* selectCheckoutAdmission.effect();
    if (!admission) {
      yield* put(checkoutUnavailable(formId, null, { status: 'unavailable', reason: 'disabled' }));
      return;
    }
    const runtime: Runtime = {
      formId,
      scopeKey: crypto.randomUUID(),
      admission,
      dead: false,
      pending: new Set(),
    };
    runtimes.set(formId, runtime);
    try {
      // Assign before resolving the saga promise: closing during capture still
      // disposes a late lease through its original owner.
      const response = yield* call(() =>
        appClient.integrations
          .captureRepositoryCheckout({
            provider: 'gitlab',
            ...(draft?.instanceBaseUrl ? { instanceBaseUrl: draft.instanceBaseUrl } : {}),
          })
          .then(async (value) => {
            if (value.status === 'ready') {
              runtime.session = value.value;
              if (runtime.dead) await value.value.release();
            }
            return value;
          }),
      );
      if (
        runtime.dead ||
        runtimes.get(formId) !== runtime ||
        (yield* selectCheckoutAdmission.effect()) !== admission
      ) {
        dispose(runtime);
        return;
      }
      if (response.status === 'unavailable') {
        yield* put(checkoutUnavailable(formId, null, response));
        dispose(runtime);
        return;
      }
      yield* put(checkoutBound(formId, runtime.scopeKey, admission, response.value.capture));
      yield* fork(observeRetirement, runtime);
      yield* put(projectQueryChanged(formId, runtime.scopeKey, ''));
      if (draft?.contextUrl) yield* put(urlSubmitted(formId, runtime.scopeKey, draft.contextUrl));
      else if (draft?.projectPath)
        yield* put(projectSelected(formId, runtime.scopeKey, draft.projectPath));
    } catch {
      if (!runtime.dead && runtimes.get(formId) === runtime)
        yield* put(checkoutUnavailable(formId, null, unreachable));
      dispose(runtime);
    }
  }
  function runtimeFor(formId: string, scopeKey: string) {
    const runtime = runtimes.get(formId);
    return runtime?.scopeKey === scopeKey && !runtime.dead ? runtime : undefined;
  }
  try {
    yield* takeEvery(opened, open);
    yield* takeEvery([closed, invalidDraftOpened], function* ({ payload: [id] }) {
      const runtime = runtimes.get(id);
      if (runtime) dispose(runtime);
    });
    yield* takeEvery(checkoutRepoConfigRequested, function* (action) {
      const [id, scope, query] = action.payload;
      const runtime = runtimeFor(id, scope);
      const matches = (form: RepositoryCheckoutForm | null) =>
        form?.capture?.checkoutId === query.checkoutId &&
        form.capture.revision === query.revision &&
        form.project?.projectPath === query.projectPath &&
        form.branch?.name === query.branch &&
        form.branch.commitSha === query.commitSha;
      try {
        if (!runtime || !matches(yield* current(runtime))) {
          yield* put(action.success(retired));
          return;
        }
        if (!runtime.session?.repoConfig) {
          yield* put(action.success({ status: 'unsupported' }));
          return;
        }
        const value = yield* call([runtime.session, runtime.session.repoConfig], query);
        if (!matches(yield* current(runtime))) {
          yield* put(action.success(retired));
          return;
        }
        yield* put(action.success(value));
        yield* authorityFailure(runtime, value);
      } catch {
        yield* put(action.success(unreachable));
      } finally {
        // A cancelled root must also settle the initializer's bounded probe.
        if (yield* cancelled()) yield* put(action.success(retired));
      }
    });
    yield* takeEvery(recoveryRequested, function* ({ payload: [id, scope] }) {
      const form = yield* selectCheckoutForm.effect(id);
      if (form?.scopeKey === scope) yield* put(opened(id, form.draft ?? undefined));
    });
    yield* takeEvery([projectQueryChanged, projectsMoreRequested], function* (action) {
      const [id, scope] = action.payload;
      const runtime = runtimeFor(id, scope);
      if (runtime)
        yield* readProjects(
          runtime,
          action.type === projectsMoreRequested.type,
          action.type === projectQueryChanged.type,
        );
    });
    yield* takeEvery([projectSelected, urlSubmitted], function* ({ payload: [id, scope] }) {
      const runtime = runtimeFor(id, scope);
      if (runtime) yield* readProject(runtime);
    });
    yield* takeEvery([branchQueryChanged, branchesMoreRequested], function* (action) {
      const [id, scope] = action.payload;
      const runtime = runtimeFor(id, scope);
      if (runtime)
        yield* readBranches(
          runtime,
          action.type === branchesMoreRequested.type,
          action.type === branchQueryChanged.type,
        );
    });
    yield* takeEvery(modeChanged, function* ({ payload: [id, scope] }) {
      const runtime = runtimeFor(id, scope);
      if (!runtime) return;
      const form = yield* current(runtime);
      if (form?.project && !form.branch) yield* readProject(runtime);
      else {
        yield* fork(readBranches, runtime, false);
        yield* warm(runtime);
      }
    });
    yield* takeEvery(
      [branchSelected, checkoutBranchRestored],
      function* ({ payload: [id, scope] }) {
        const runtime = runtimeFor(id, scope);
        if (runtime) yield* warm(runtime);
      },
    );
    yield* takeLatestFromSelector(
      selectCheckoutAdmission,
      function* ({ payload: admission }: SelectorChannelPayload<string | null>) {
        for (const runtime of [...runtimes.values()]) {
          if (runtime.admission === admission) continue;
          const form = yield* selectCheckoutForm.effect(runtime.formId);
          if (form) yield* put(checkoutUnavailable(runtime.formId, form.scopeKey, retired));
          dispose(runtime);
        }
      },
    );
  } finally {
    for (const runtime of [...runtimes.values()]) dispose(runtime);
  }
}
