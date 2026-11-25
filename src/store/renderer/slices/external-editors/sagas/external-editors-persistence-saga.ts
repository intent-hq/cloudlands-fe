import type { SagaGenerator } from 'typed-redux-saga';

import {
  sharedPreferenceSaga,
  type SharedPreferenceSagaOptions,
} from '../../../utils/shared-preference-saga';
import { selectEditorOrder, selectHiddenEditorIds } from '../external-editors-selectors';
import {
  normalizeHiddenEditorIds,
  normalizeEditorOrder,
  fetchEditorsSuccess,
  setEditorOrder,
  setHiddenEditorIds,
  setOpenAction,
  toggleHiddenEditor,
} from '../external-editors-slice';

const OPEN_ACTION_STORAGE_KEY = 'open-combo-button-last-action';
const HIDDEN_EDITORS_STORAGE_KEY = 'legacy-settings:hiddenOpenInEditors';
export const EDITOR_ORDER_STORAGE_KEY = 'settings:openInEditorsOrder';

function parseJsonText(stored: unknown): unknown {
  if (typeof stored !== 'string') return undefined;
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}

/** Hidden editors default to visible when the saved JSON is not valid. */
const hiddenEditorsPreference: SharedPreferenceSagaOptions<string[]> = {
  key: HIDDEN_EDITORS_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  serialize: JSON.stringify,
  parse: (stored) => {
    const parsed = parseJsonText(stored);
    return parsed === undefined ? undefined : normalizeHiddenEditorIds(parsed);
  },
  hydrate: (hiddenEditorIds) =>
    hiddenEditorIds === undefined ? null : setHiddenEditorIds(hiddenEditorIds),
  persistOn: toggleHiddenEditor,
  select: selectHiddenEditorIds.effect,
};

const editorOrderPreference: SharedPreferenceSagaOptions<string[]> = {
  key: EDITOR_ORDER_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  serialize: JSON.stringify,
  parse: (stored) => {
    const parsed = parseJsonText(stored);
    return parsed === undefined ? undefined : normalizeEditorOrder(parsed);
  },
  hydrate: (order) => (order?.length ? setEditorOrder(order) : null),
  persistOn: [setEditorOrder, fetchEditorsSuccess],
  select: selectEditorOrder.effect,
};

/** Not loaded at boot; a choice is saved, and other open views follow it. */
const openActionPreference: SharedPreferenceSagaOptions<string> = {
  key: OPEN_ACTION_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  parse: (stored) => (typeof stored === 'string' && stored ? stored : undefined),
  hydrate: (openAction, source) =>
    source === 'storage' && openAction !== undefined ? setOpenAction(openAction) : null,
  persistOn: setOpenAction,
  fromAction: (action) => {
    const [openAction] = (action as ReturnType<typeof setOpenAction>).payload;
    return typeof openAction === 'string' ? openAction : undefined;
  },
};

/** Unregistered until the S20 middleware cutover. */
export function* externalEditorsPersistenceSaga(): SagaGenerator<void> {
  yield* sharedPreferenceSaga(hiddenEditorsPreference);
  yield* sharedPreferenceSaga(editorOrderPreference);
  yield* sharedPreferenceSaga(openActionPreference);
}
