import type { NpxStatus } from '$shared/types/provider-availability';
import type { SetupResult } from '$shared/types/workspace-draft';
import type { Capability, ControllerState } from '../controller';

export type CoordinatorState =
  | 'checking'
  | 'connect-provider'
  | 'login-required'
  | 'test-failed'
  | 'ready-idle'
  | 'message-pending'
  | 'live'
  | 'daemon-offline';
type SourceAccess = 'public' | 'private' | 'no-access';
type LocalSourceKind = 'git' | 'non-git';
export type NewFolderNameError =
  'required' | 'path-separator' | 'dot-name' | 'null-character' | 'invalid-character' | 'too-long';

interface ProviderCardPresentation {
  id: string;
  name: string;
  available: boolean;
  authenticated: boolean | undefined;
  statusLoading: boolean;
  authDetails: string | undefined;
  docsUrl: string;
  installCommand: string;
  loginCommandHint?: string;
  hasNpxFallback: boolean;
  warning?: string;
}

export interface CoordinatorPresentation {
  state?: CoordinatorState;
  provider?: ProviderCardPresentation;
  providerBrand?: { color1: string; color2: string; isLight?: boolean };
  npxStatus?: NpxStatus | null;
  deviceFlow?: { userCode: string; verificationUri: string };
  detail?: string;
}

export interface SourcePresentation {
  unresolvedLink?: string;
  githubAccess?: SourceAccess;
  localKind?: LocalSourceKind;
}

interface ProgressPresentation {
  clone?: { phase: string; percent?: number };
  setup?: SetupResult;
}

export interface NewWorkspacePresentation {
  hostName?: string;
  coordinator?: CoordinatorPresentation;
  source?: SourcePresentation;
  progress?: ProgressPresentation;
  specContent?: string;
  requiredCapabilities?: Capability[];
}

export function getNewFolderNameError(name: string): NewFolderNameError | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'required';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'path-separator';
  if (trimmed === '.' || /^\.+$/.test(trimmed)) return 'dot-name';
  if (trimmed.includes('\0')) return 'null-character';
  if (/[<>:"|?*]/.test(trimmed)) return 'invalid-character';
  if (trimmed.length > 255) return 'too-long';
  return undefined;
}

export function coordinatorStateFor(controller: ControllerState): CoordinatorState {
  if (controller.phase === 'offline') return 'daemon-offline';
  if (controller.phase === 'boot' || controller.phase === 'restoring') return 'checking';
  if (controller.phase === 'sending') return 'message-pending';
  if (controller.phase === 'live') return 'live';
  if (controller.capabilities.provider === 'ready') return 'ready-idle';
  if (controller.capabilities.provider === 'missing') return 'connect-provider';
  return 'checking';
}

export function isEditorEnabled(controller: ControllerState): boolean {
  return !['promoting', 'adopting', 'placingAttachments', 'sending', 'live'].includes(
    controller.phase,
  );
}

export function isProgressPhase(controller: ControllerState): boolean {
  return ['starting', 'promoting', 'adopting', 'placingAttachments', 'sending'].includes(
    controller.phase,
  );
}
