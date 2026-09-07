import type { NpxStatus } from '$shared/types/provider-availability';
import type { SetupResult } from '$shared/types/workspace-draft';
import type { DaemonHostRepairTarget } from '$store/renderer/slices/daemon-health/daemon-health-types';
import type { Capability, CapabilityStatus, ControllerState } from '../controller';

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
  host?: DaemonHostRepairTarget;
  remoteDaemonPathRejection?: string;
  coordinator?: CoordinatorPresentation;
  source?: SourcePresentation;
  progress?: ProgressPresentation;
  specContent?: string;
  requiredCapabilities?: Capability[];
}

export function providerCapabilityStatus(input: {
  catalogLoaded: boolean;
  hasEnabledProvider: boolean;
  hasCheckedOnce: boolean;
  hasAvailableProvider: boolean;
}): CapabilityStatus | null {
  if (!input.catalogLoaded) return null;
  if (!input.hasEnabledProvider) return 'missing';
  if (!input.hasCheckedOnce) return null;
  return input.hasAvailableProvider ? 'ready' : 'missing';
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
