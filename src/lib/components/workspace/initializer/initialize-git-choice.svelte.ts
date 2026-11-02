import { fromStore } from 'svelte/store';
import {
  selectInitializeGitDefaultState,
  selectPlainFolderCreationAvailable,
} from '$store/renderer/slices/workspace-initializer/plain-folder-selectors';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { readRememberedInitializeGit, writeRememberedInitializeGit } from './plain-folder-create';

export interface InitializeGitChoice {
  /** Labs flag on and the daemon accepts plain-folder creates. */
  readonly available: boolean;
  /** The toggle is shown: available and its default has been decided. */
  readonly visible: boolean;
  /** Effective choice: `true` (today's git behavior) unless the visible toggle is off. */
  readonly initializeGit: boolean;
  /** The user flipped the toggle; the choice is remembered. */
  set(value: boolean): void;
}

type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The "Initialize as git repository" toggle state for one create surface.
 * Call during component initialisation. The remembered choice wins; otherwise
 * the first decided default is latched, so the toggle never flips while visible.
 */
export function createInitializeGitChoice(
  options: { storage?: ChoiceStorage | null } = {},
): InitializeGitChoice {
  const storage = options.storage === undefined ? safeLocalStorage : options.storage;
  const available = fromStore(selectPlainFolderCreationAvailable());
  const defaultState = fromStore(selectInitializeGitDefaultState());

  let value = $state<boolean | null>(readRememberedInitializeGit(storage));

  // Decided only once the forge statuses and workspace list have loaded.
  $effect(() => {
    if (value !== null || !available.current) return;
    const state = defaultState.current;
    if (state === 'on') value = true;
    else if (state === 'off') value = false;
  });

  return {
    get available() {
      return available.current === true;
    },
    get visible() {
      return available.current === true && value !== null;
    },
    get initializeGit() {
      return !(available.current === true && value === false);
    },
    set(next: boolean) {
      value = next;
      writeRememberedInitializeGit(storage, next);
    },
  };
}
