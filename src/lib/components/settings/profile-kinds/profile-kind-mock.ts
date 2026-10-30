/**
 * Presentational types and folder-preview helpers for the redesigned
 * add/edit profile dialog mock-ups. Everything here is props-only: no store,
 * no daemon calls.
 */

import {
  loginCommand,
  profileFoldersParent,
  slugifyProfileName,
  type ProfileKind,
  type ProfileLoginMode,
  type ProfileProvider,
} from '$lib/provider-profile-kinds';

export type ProfileKindProvider = ProfileProvider;

/** The four cards on step 1. */
export type ProfileKindChoice = ProfileKind;

/** Where the dialog is in the add flow. */
export type ProfileKindStep = 'pick' | 'details';

/** Which sign-in the edit screen (or ⋯ → Log In) starts. */
export type ProfileSignInMethod = ProfileLoginMode;

/** The terminal sign-in the dialog is waiting on, as shown to the user. */
export type ProfileSignInState =
  | { status: 'idle' }
  /** `deviceAuth`: Codex on a non-sidecar daemon (`codex login --device-auth`). */
  | { status: 'waiting'; deviceAuth?: boolean }
  | { status: 'stillWaiting' }
  /** `email` is the Claude identity; Codex reports none. */
  | { status: 'signedIn'; email?: string }
  | { status: 'checkingKey' }
  | { status: 'keyWorks' }
  | { status: 'keyRejected' };

/** What Save does with a saved Custom endpoint (`ANTHROPIC_BASE_URL`, masked on read). */
export type BaseUrlAction = 'keep' | 'replace' | 'remove';

/** Failures after the profile was saved (the profile itself stays). */
export type ProfileSetupError = { kind: 'folderFailed'; path: string } | { kind: 'terminalFailed' };

/** The `~/…` folder a new Different-login profile would use (never desktop-expanded). */
export function previewProfileFolder(
  provider: ProfileKindProvider,
  name: string,
  suffix: string,
): string {
  return `${profileFoldersParent(provider)}/${slugifyProfileName(name)}-${suffix}`;
}

/** The plain terminal command for a sign-in; the folder goes in `env`, never here. */
export function signInCommand(
  provider: ProfileKindProvider,
  method: ProfileSignInMethod,
  remoteDaemon: boolean,
): string {
  return loginCommand(provider, method, !remoteDaemon);
}

/** A profile row's status, as ProviderProfiles shows it ('error' reads "Not signed in"). */
export type MockProfileStatus = 'checking' | 'ready' | 'error' | 'configured';

/** Fake profile row data for the rows mock-up. */
export interface MockProfileRow {
  id: string;
  name: string;
  kind: ProfileKindChoice;
  status: MockProfileStatus;
  /** Claude identity, shown as "Signed in as <email>" when Ready. */
  email?: string;
  backup?: boolean;
  /** Different login: the folder saved on the profile. */
  folderPath?: string;
}
