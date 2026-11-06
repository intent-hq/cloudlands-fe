/**
 * Cloud machines on E2B (PROTOCOL `methods/nodes.md` → "Cloud machines (E2B)").
 *
 * The backend owner saves an E2B API key on the backend; the backend then
 * starts one sandbox per agent placed with `target: "e2b"`. The key is a
 * write-only `cloudMachines.configure` param: no type below carries it, so it
 * never lands in Redux.
 */

export type CloudMachineSize = '2x4' | '4x8' | '8x16' | '16x32';
const CLOUD_MACHINE_SIZES: readonly CloudMachineSize[] = ['2x4', '4x8', '8x16', '16x32'];
export const DEFAULT_CLOUD_MACHINE_SIZE: CloudMachineSize = '4x8';
export const DEFAULT_IDLE_PAUSE_MINUTES = 10;
export const DEFAULT_PAUSED_DELETE_DAYS = 7;

export interface CloudMachineSizeInfo {
  id: CloudMachineSize;
  vcpu: number;
  memoryMiB: number;
  /** The lowest E2B plan that allows the size. */
  plan: 'hobby' | 'pro-raised-limits' | string;
}

type CloudProviderState = 'ready' | 'key-rejected' | 'unreachable';

export interface CloudMachineProvider {
  id: 'e2b';
  name: string;
  state: CloudProviderState | string;
  template: string;
  templateProject: string;
  agentProviders: string[];
  /** Published sizes for this backend's version, smallest first. */
  sizes: CloudMachineSizeInfo[];
  size: CloudMachineSize;
  idlePauseMinutes: number;
  pausedDeleteDays: number;
  configuredAt: string;
  checkedAt?: string;
}

type CloudSandboxState = 'running' | 'pausing' | 'paused' | 'resuming' | 'stopping';

/** `RemoteMachine.cloud`: only on cloud machine rows. */
export interface CloudMachineState {
  provider: 'e2b';
  sandboxId: string;
  state: CloudSandboxState | string;
  template: string;
  size: CloudMachineSize | string;
  startedBy: { principalId: string; displayName: string | null };
  agentId: string;
  workspaceId: string;
  startedAt: string;
  runningSeconds: number;
}

/** `cloudMachines.configure` params, minus the provider. */
export interface CloudMachineConfigureInput {
  /** Secret: sent once, never stored in state. */
  apiKey?: string;
  size?: CloudMachineSize;
  idlePauseMinutes?: number;
  pausedDeleteDays?: number;
}

/** The typed error data of the three cloud codes (PROTOCOL "Remote machine errors"). */
export type CloudMachineErrorData =
  | {
      code: 'cloud-machine-unavailable';
      reason: string;
      retryable: boolean;
      status?: number;
    }
  | { code: 'cloud-profile-required'; providerRef?: string }
  | {
      code: 'cloud-quota';
      limit: 'concurrency' | 'rate' | 'plan' | string;
      retryAfterSeconds?: number;
      retryable: boolean;
    };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const positiveInt = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;

export function isCloudMachineSize(value: unknown): value is CloudMachineSize {
  return CLOUD_MACHINE_SIZES.includes(value as CloudMachineSize);
}

function parseSize(value: unknown): CloudMachineSizeInfo | null {
  if (!record(value) || !isCloudMachineSize(value.id)) return null;
  const vcpu = positiveInt(value.vcpu);
  const memoryMiB = positiveInt(value.memoryMiB);
  if (!vcpu || !memoryMiB) return null;
  return { id: value.id, vcpu, memoryMiB, plan: text(value.plan) ? value.plan : 'hobby' };
}

/** Narrow one wire `CloudMachineProvider`; null for an unknown provider or shape. */
export function parseCloudMachineProvider(value: unknown): CloudMachineProvider | null {
  if (!record(value) || value.id !== 'e2b' || !text(value.state) || !text(value.configuredAt))
    return null;
  return {
    id: 'e2b',
    name: text(value.name) ? value.name : 'E2B', // i18n-ignore (product name)
    state: value.state,
    template: text(value.template) ? value.template : '',
    templateProject: text(value.templateProject) ? value.templateProject : '',
    agentProviders: Array.isArray(value.agentProviders)
      ? value.agentProviders.filter((id): id is string => text(id))
      : [],
    sizes: Array.isArray(value.sizes) ? value.sizes.flatMap((size) => parseSize(size) ?? []) : [],
    size: isCloudMachineSize(value.size) ? value.size : DEFAULT_CLOUD_MACHINE_SIZE,
    idlePauseMinutes: positiveInt(value.idlePauseMinutes) ?? DEFAULT_IDLE_PAUSE_MINUTES,
    pausedDeleteDays: positiveInt(value.pausedDeleteDays) ?? DEFAULT_PAUSED_DELETE_DAYS,
    configuredAt: value.configuredAt,
    ...(text(value.checkedAt) ? { checkedAt: value.checkedAt } : {}),
  };
}

/** Narrow `RemoteMachine.cloud`; null when absent or malformed. */
export function parseCloudMachineState(value: unknown): CloudMachineState | null {
  if (
    !record(value) ||
    value.provider !== 'e2b' ||
    !text(value.sandboxId) ||
    !text(value.state) ||
    !text(value.agentId) ||
    !text(value.workspaceId) ||
    !text(value.startedAt)
  )
    return null;
  const startedBy = record(value.startedBy) ? value.startedBy : {};
  const seconds = value.runningSeconds;
  return {
    provider: 'e2b',
    sandboxId: value.sandboxId,
    state: value.state,
    template: text(value.template) ? value.template : '',
    size: text(value.size) ? value.size : DEFAULT_CLOUD_MACHINE_SIZE,
    startedBy: {
      principalId: text(startedBy.principalId) ? startedBy.principalId : '',
      displayName: text(startedBy.displayName) ? startedBy.displayName : null,
    },
    agentId: value.agentId,
    workspaceId: value.workspaceId,
    startedAt: value.startedAt,
    runningSeconds:
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? Math.floor(seconds)
        : 0,
  };
}

/** The cloud error data in a JSON-RPC error's `data`, or null for any other code. */
export function parseCloudMachineError(data: unknown): CloudMachineErrorData | null {
  if (!record(data)) return null;
  switch (data.code) {
    case 'cloud-machine-unavailable':
      return {
        code: data.code,
        reason: text(data.reason) ? data.reason : 'api-error',
        retryable: data.retryable === true,
        ...(Number.isInteger(data.status) ? { status: data.status as number } : {}),
      };
    case 'cloud-profile-required':
      return {
        code: data.code,
        ...(text(data.providerRef) ? { providerRef: data.providerRef } : {}),
      };
    case 'cloud-quota': {
      const retryAfterSeconds = positiveInt(data.retryAfterSeconds);
      return {
        code: data.code,
        limit: text(data.limit) ? data.limit : 'concurrency',
        retryable: data.retryable === true,
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      };
    }
    default:
      return null;
  }
}

/** E2B's published per-second rates (USD), billed only while a sandbox runs. */
const USD_PER_VCPU_SECOND = 0.000014;
const USD_PER_GIB_SECOND = 0.0000045;

/** vCPU and GiB of a size id ("4x8"), or null for an unknown id. */
export function cloudSizeResources(size: string): { vcpu: number; memoryGiB: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { vcpu: Number(match[1]), memoryGiB: Number(match[2]) } : null;
}

/** Estimated E2B compute cost in USD for `runningSeconds` at `size`; null for an unknown size. */
export function estimateCloudCost(size: string, runningSeconds: number): number | null {
  const resources = cloudSizeResources(size);
  if (!resources) return null;
  return (
    runningSeconds *
    (resources.vcpu * USD_PER_VCPU_SECOND + resources.memoryGiB * USD_PER_GIB_SECOND)
  );
}
