/**
 * Set up a new machine over SSH (Labs): the contract between the wizard
 * (renderer) and the SSH runner (main). Secrets (password, passphrase) cross
 * only in the start request and stay in main for that run. The pairing link
 * the installer prints never crosses: main hands it to the pair-link or
 * node-invite pipeline and returns only a pending id.
 */

/** What the wizard installs: a full backend, or a node that only runs agents. */
export type MachineSetupTarget = 'backend' | 'node';

export type SshAuthMethod = 'agent' | 'key' | 'password';

export type SshAuth =
  | { method: 'agent' }
  | { method: 'key'; keyPath: string; passphrase?: string }
  | { method: 'password'; password: string };

export interface SshSetupStartParams {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  target: MachineSetupTarget;
}

/** The SSH login fields kept between runs (never a secret). */
export interface SshLoginPrefill {
  host: string;
  port: number;
  username: string;
  method: SshAuthMethod;
  keyPath: string;
}

/**
 * `found` replaces `installing` when the computer already runs intentd: the
 * runner then never installs, restarts or reconfigures it.
 */
export type SshSetupStep =
  'connecting' | 'installing' | 'found' | 'starting' | 'pairing' | 'adding';

export type SshSetupErrorCode =
  /** No route, DNS failure, refused or timed-out TCP connection. */
  | 'unreachable'
  /** The server refused every offered sign-in. */
  | 'auth-refused'
  /** No SSH agent is running (no `SSH_AUTH_SOCK`, no Pageant). */
  | 'no-agent'
  /** The key file could not be read or parsed (or the passphrase is wrong). */
  | 'key-unreadable'
  /** The host key differs from `~/.ssh/known_hosts`. */
  | 'host-key-mismatch'
  /** The user did not trust an unknown host key. */
  | 'host-key-declined'
  /** `uname -s` is not Linux (SSH setup supports Linux only). */
  | 'unsupported-os'
  /** The installer (or the fallback `intentd pair`) exited non-zero. */
  | 'install-failed'
  /** No link before a timeout, or the run exited without one. */
  | 'no-link'
  /** The captured link failed the pair-link or node-invite check. */
  | 'link-rejected'
  /** Installed intentd is stopped and has no `start` subcommand (a direct, non-sitter build). */
  | 'no-start'
  /** Installed intentd did not come up after the start. */
  | 'did-not-start'
  /** Installed intentd cannot pair: no `--tunnel` / `--node`, or no node invites. */
  | 'too-old'
  /** Node card on an orchestrator-mode backend (it runs no agents itself). */
  | 'orchestrator'
  /** `intentd pair` failed for another reason. */
  | 'pair-failed'
  | 'failed';

/** The pairing link main captured and holds; the renderer adds it. */
export type SshSetupLink =
  | {
      /** An `intent://pair` link: held by the pair-link pipeline. */
      kind: 'pair';
      pendingId: string;
      machineKind: 'machine' | 'node';
      label: string;
      existingId: string | null;
    }
  | {
      /** An `intent://node` link: held by the node-invite pipeline. */
      kind: 'invite';
      pendingId: string;
      label: string;
    };

export interface SshSetupResult {
  link: SshSetupLink;
  /**
   * Linux: lingering is still off, so the service stops when the user logs
   * out; the success screen shows `sudo loginctl enable-linger <user>`.
   */
  lingerUser: string | null;
  /** intentd was already installed: nothing was installed or restarted. */
  existing: boolean;
  /** Pairing turned on remote connections or the Tailcat tunnel (existing installs). */
  remoteTurnedOn: boolean;
}

export type SshSetupEvent =
  | { runId: string; type: 'step'; step: SshSetupStep }
  /** Redacted output lines (no link, QR code, URL, Token or Fingerprint line). */
  | { runId: string; type: 'log'; lines: string[] }
  /** An unknown host key: answer with `SSH_TRUST`. */
  | {
      runId: string;
      type: 'host-key';
      /** `SHA256:<base64>` as `ssh-keygen -l` prints it. */
      fingerprint: string;
      algorithm: string;
    }
  | { runId: string; type: 'done'; result: SshSetupResult }
  | {
      runId: string;
      type: 'failed';
      code: SshSetupErrorCode;
      /** The step that failed, for the step list. */
      step: SshSetupStep;
      /** The fingerprint the server presented, for `host-key-mismatch`. */
      fingerprint?: string;
      /** `uname -s` output, for `unsupported-os`. */
      os?: string;
    };

/** What the login screen defaults to. */
export interface SshSetupDefaults {
  /** `SSH_AUTH_SOCK` is set (or Windows, where Pageant is tried). */
  agent: boolean;
}

export type SshSetupStartResult = { ok: true; runId: string } | { ok: false; code: 'busy' };
