/**
 * Diagnosis for a `workspace.create` base-refresh failure (PROTOCOL §9.2):
 * the daemon's `git fetch <remote> <baseRef>` failed on the machine Intent
 * runs on, before any checkout was made. The daemon's `category` picks the
 * guidance; its redacted `detail` is what users read as the cause. The
 * transport and SSH host are read from that detail only to tailor guidance.
 */
import {
  BASE_REFRESH_FAILED_CODE,
  type BaseRefreshCategory,
  type BaseRefreshFailure,
} from '$shared/types/base-refresh-failure';

export interface BaseRefreshDiagnosis {
  category: BaseRefreshCategory;
  baseRef: string;
  remote: string;
  /** Git's error text (daemon-redacted), or the readable message when git gave none. */
  cause: string;
  /** Remote transport inferred from the cause, for auth guidance. */
  transport: 'ssh' | 'https' | 'unknown';
  /** `[user@]host` for the `ssh -T` command, when git named it. */
  sshHost?: string;
}

const SSH_HINT = /permission denied \(publickey|host key|ssh:\/\/|ssh_|ssh-agent|[\w.-]+@[\w.-]+:/i;
const HTTPS_HINT = /https?:\/\/|could not read (username|password)|credential/i;

function sshHost(cause: string): string | undefined {
  const userHost = cause.match(/(?:ssh:\/\/)?\b([\w.-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[:/])/i);
  if (userHost) return userHost[1];
  const named = cause.match(/host key (?:is known )?for ([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  return named?.[1];
}

/**
 * Undefined unless `errorCode` is `base-refresh-failed`: Continue from
 * last-fetched is offered only for that code, which older daemons never send.
 */
export function diagnoseBaseRefreshError(
  message: string | null | undefined,
  errorCode?: string | null,
  failure?: BaseRefreshFailure | null,
): BaseRefreshDiagnosis | undefined {
  if (errorCode !== BASE_REFRESH_FAILED_CODE) return undefined;
  const cause = failure?.detail.trim() ? failure.detail : (message ?? '');
  const transport = SSH_HINT.test(cause) ? 'ssh' : HTTPS_HINT.test(cause) ? 'https' : 'unknown';
  const host = sshHost(cause);
  return {
    category: failure?.category ?? 'other',
    baseRef: failure?.baseRef ?? '',
    remote: failure?.remote ?? '',
    cause,
    transport,
    ...(host ? { sshHost: host } : {}),
  };
}
