import { isAllowedVerificationUri } from '../../deeplink/utils/verification-uri';
import type { ForgeUser } from '../../forge-auth/types';
import type { PrincipalIdentity } from '../../workspace-sharing/types';
import {
  identitiesEqual,
  identityParams,
  isCollaborationIdentity,
  validIdentityTarget,
} from '../identity';
import type {
  CollaborationAction,
  CollaborationAuthStatus,
  CollaborationError,
  CollaborationOutcome,
  CollaborationPolicy,
  CollaborationRequest,
  CollaborationView,
  IdentityTarget,
} from '../types';

/** Captured from the local pooled connection, never from the invoking window's host. */
export interface LocalIdentityLease {
  supported: boolean;
  gitlabSupported: boolean;
  current(): boolean;
  request<T>(method: string, params: object): Promise<T>;
}

/** Main-only binding to one original invitation target and metadata revision. */
export interface CollaborationAttempt {
  readonly id: string;
  readonly metadataRevision: number;
  current(): boolean;
}

export interface PreparedCollaborationIdentity {
  attempt: CollaborationAttempt;
  identity: PrincipalIdentity;
  login: string;
  invitation: CollaborationRequest;
  /** Main-only lifetime; the renderer receives neither this client nor a credential. */
  local: LocalIdentityLease;
  allowed(): boolean;
}

type DeviceGrant = {
  purpose: 'collaboration';
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval?: number;
};
type ConnectResult = DeviceGrant | { purpose: 'collaboration'; ok: true };
const boundedErrors = new Set<CollaborationError>([
  'identity-mismatch',
  'identity-in-use',
  'device-grant-unsupported',
  'rate-limited',
]);

class CollaborationAuthFailure extends Error {
  constructor(readonly code: CollaborationError) {
    super(code);
  }
}

function failureCode(error: unknown): CollaborationError {
  if (error instanceof CollaborationAuthFailure) return error.code;
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code && boundedErrors.has(code as CollaborationError)) return code as CollaborationError;
  if (
    code === 'github-scope-missing' ||
    code === 'gitlab-scope-missing' ||
    code === 'source-control-scope-missing'
  )
    return 'scope-missing';
  return 'sign-in-failed';
}

/** All auth/proof operations have an explicit wire purpose and one immutable local lease. */
export class CollaborationIdentityClient {
  constructor(readonly local: LocalIdentityLease) {}
  async call<T>(method: string, params: object): Promise<T> {
    if (!this.local.current()) throw new CollaborationAuthFailure('local-connection-changed');
    if (!this.local.supported) throw new CollaborationAuthFailure('upgrade-required');
    const result = await this.local.request<T>(method, params);
    if (!this.local.current()) throw new CollaborationAuthFailure('local-connection-changed');
    return result;
  }
  async status(target: IdentityTarget): Promise<CollaborationAuthStatus> {
    const result = await this.call<CollaborationAuthStatus>(
      'identity.authStatus',
      identityParams(target),
    );
    if (
      result.purpose !== 'collaboration' ||
      result.provider !== target.provider ||
      result.host !== target.host ||
      !Array.isArray(result.requestedScopes) ||
      !(result.grantedScopes === null || Array.isArray(result.grantedScopes))
    )
      throw new CollaborationAuthFailure('sign-in-failed');
    return result;
  }
  user(target: IdentityTarget) {
    return this.call<{ user: ForgeUser | null }>('identity.getUser', identityParams(target));
  }
  connect(target: IdentityTarget, token?: string) {
    return this.call<ConnectResult>('identity.connect', {
      ...identityParams(target),
      method: token === undefined ? 'device' : 'pat',
      ...(token === undefined ? {} : { token }),
    });
  }
  cancel(target: IdentityTarget, flowId: string) {
    return this.call('identity.cancelAuth', { ...identityParams(target), flowId });
  }
  select(identity: PrincipalIdentity) {
    return this.call<{ principal: { identity?: PrincipalIdentity } }>('identity.select', {
      ...identityParams(identity),
      externalUserId: identity.externalUserId,
    });
  }
  createProof(prepared: PreparedCollaborationIdentity, nonce: string, hostLabel: string) {
    if (!prepared.allowed()) throw new CollaborationAuthFailure('multiplayer-disabled');
    return this.call<{
      provider: string;
      host: string;
      externalUserId: string;
      proofId: string;
      login: string;
    }>('sourceControl.identityProof.create', {
      ...identityParams(prepared.identity),
      purpose: 'collaboration',
      expectedIdentity: prepared.identity,
      nonce,
      hostLabel,
    });
  }
  deleteProof(target: IdentityTarget, proofId: string) {
    return this.call('sourceControl.identityProof.delete', {
      ...identityParams(target),
      purpose: 'collaboration',
      proofId,
    });
  }
}

export interface CollaborationFlowDeps {
  local: LocalIdentityLease;
  attempt: CollaborationAttempt;
  show(view: CollaborationView): void;
  finish(result: CollaborationOutcome<PreparedCollaborationIdentity>): void;
  openBrowser(url: string): Promise<void>;
  /** Protect a resident flow adopted by a later dialog from late-start cleanup. */
  isLatest(): boolean;
  policy?(): CollaborationPolicy;
}

export class CollaborationAuthFlow {
  private readonly client: CollaborationIdentityClient;
  private policy: CollaborationPolicy = { multiplayer: false, gitlab: false };
  private initialized = false;
  private ended = false;
  private revision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private flowId?: string;
  private deadline = 0;
  private latestConnect?: { revision: number; target: IdentityTarget };
  private readonly view: CollaborationView;

  constructor(
    requestId: string,
    request: CollaborationRequest,
    private readonly deps: CollaborationFlowDeps,
  ) {
    this.client = new CollaborationIdentityClient(deps.local);
    this.view = {
      requestId,
      request,
      target: request.pinIdentity ?? { provider: 'github', host: 'github.com' },
      phase: 'loading',
      user: null,
      requestedScopes: [],
      grantedScopes: null,
      deviceGrantSupported: false,
    };
  }
  snapshot(): CollaborationView {
    return structuredClone(this.view);
  }
  private publish() {
    if (!this.ended) this.deps.show(this.snapshot());
  }
  private guardAttempt() {
    if (!this.deps.attempt.current()) throw new CollaborationAuthFailure('request-changed');
    if (this.ended || !this.deps.local.current())
      throw new CollaborationAuthFailure('local-connection-changed');
    if (!this.policy.multiplayer) throw new CollaborationAuthFailure('multiplayer-disabled');
    if (!this.deps.local.supported) throw new CollaborationAuthFailure('upgrade-required');
  }
  private guardProvider(target: IdentityTarget) {
    if (target.provider === 'gitlab' && !this.deps.local.gitlabSupported)
      throw new CollaborationAuthFailure('upgrade-required');
    if (target.provider === 'gitlab' && !this.policy.gitlab)
      throw new CollaborationAuthFailure('gitlab-disabled');
  }
  private guard() {
    this.guardAttempt();
    this.guardProvider(this.view.target);
  }
  private valid(revision: number) {
    if (!this.deps.attempt.current()) {
      this.cancel();
      return false;
    }
    return (
      !this.ended &&
      revision === this.revision &&
      this.deps.local.current() &&
      this.deps.attempt.current()
    );
  }
  private stopFlow() {
    clearTimeout(this.timer);
    const flowId = this.flowId;
    this.flowId = undefined;
    return flowId && this.deps.local.current()
      ? this.client.cancel(this.view.target, flowId).then(
          () => {},
          () => {},
        )
      : Promise.resolve();
  }
  private selection() {
    return {
      target: { provider: this.view.target.provider, host: this.view.target.host },
      ...(this.view.user ? { displayedAccountId: this.view.user.id } : {}),
    };
  }
  cancel() {
    if (this.ended) return;
    void this.stopFlow();
    this.ended = true;
    this.revision++;
    this.deps.finish({
      kind: 'cancelled',
      request: this.view.request,
      selection: this.selection(),
    });
  }
  invalidate() {
    if (this.ended) return;
    void this.stopFlow();
    this.ended = true;
    this.revision++;
    this.deps.finish({
      kind: 'error',
      code: 'local-connection-changed',
      request: this.view.request,
      selection: this.selection(),
    });
  }
  async action(action: CollaborationAction): Promise<void> {
    if (this.ended) return;
    if (action.type === 'cancel') {
      this.cancel();
      return;
    }
    if (action.type === 'policy') {
      this.policy = action.policy;
      if (
        !this.policy.multiplayer ||
        (this.initialized && this.view.target.provider === 'gitlab' && !this.policy.gitlab)
      ) {
        this.cancel();
        return;
      }
      if (this.initialized) return;
      this.initialized = true;
    }
    let revision = this.revision;
    try {
      this.guardAttempt();
      if (action.type !== 'choose') this.guardProvider(this.view.target);
      if (action.type === 'open-browser') {
        if (this.view.device) await this.deps.openBrowser(this.view.device.verificationUri);
        return;
      }
      revision = ++this.revision;
      const consented =
        action.type === 'confirm' && this.view.phase === 'account' && this.view.user
          ? { ...this.view.target, externalUserId: this.view.user.id }
          : null;
      if (action.type === 'confirm' && !consented)
        throw new CollaborationAuthFailure('identity-mismatch');
      if (action.type === 'policy') {
        if (
          this.view.request.pinIdentity != null &&
          !isCollaborationIdentity(this.view.request.pinIdentity)
        )
          throw new CollaborationAuthFailure('identity-mismatch');
        if (this.view.request.scope === 'host' && !this.view.request.pinIdentity)
          throw new CollaborationAuthFailure('identity-mismatch');
        // Explicit null/settings follows the selected local identity. Omission retains GitHub's legacy default.
        if (this.view.request.pinIdentity === null || this.view.request.scope === 'settings') {
          const principal = await this.client.call<{ identity?: PrincipalIdentity }>(
            'principal.me',
            {},
          );
          if (!this.valid(revision)) return;
          if (principal.identity != null) {
            if (!isCollaborationIdentity(principal.identity))
              throw new CollaborationAuthFailure('identity-mismatch');
            this.view.target = {
              provider: principal.identity.provider,
              host: principal.identity.host,
            };
          }
        }
      }
      if (action.type === 'choose') {
        if (!validIdentityTarget(action.target)) throw new CollaborationAuthFailure('invalid-host');
        const pin = this.view.request.pinIdentity;
        if (pin && (pin.provider !== action.target.provider || pin.host !== action.target.host))
          throw new CollaborationAuthFailure('identity-mismatch');
        // A provider choice must be admitted against its requested target, not the saved one.
        this.guardProvider(action.target);
        await this.stopFlow();
        if (!this.valid(revision)) return;
        this.view.target = action.target;
        this.view.user = null;
        this.view.requestedScopes = [];
        this.view.grantedScopes = null;
        this.view.deviceGrantSupported = false;
      }
      this.guard();
      this.view.phase = 'loading';
      this.view.error = undefined;
      this.view.device = undefined;
      this.publish();
      if (action.type === 'connect') {
        await this.stopFlow();
        if (!this.valid(revision)) return;
        const target = { ...this.view.target };
        this.latestConnect = { revision, target };
        // Keep the raw completion so cancellation can clean up a grant that started late.
        const result = await this.deps.local.request<ConnectResult>('identity.connect', {
          ...identityParams(target),
          method: action.token === undefined ? 'device' : 'pat',
          ...(action.token === undefined ? {} : { token: action.token }),
        });
        if (!this.valid(revision)) {
          const adoptedByNewer =
            this.latestConnect.revision !== revision &&
            this.latestConnect.target.provider === target.provider &&
            this.latestConnect.target.host === target.host;
          if (
            !adoptedByNewer &&
            'flowId' in result &&
            this.deps.isLatest() &&
            this.deps.local.current()
          )
            void this.client.cancel(target, result.flowId).catch(() => {});
          return;
        }
        this.guard();
        if (result.purpose !== 'collaboration')
          throw new CollaborationAuthFailure('sign-in-failed');
        if ('flowId' in result) {
          this.flowId = result.flowId;
          const url = new URL(result.verificationUri);
          if (
            !result.flowId ||
            !result.userCode ||
            !Number.isFinite(result.expiresIn) ||
            result.expiresIn <= 0 ||
            (target.provider === 'github' && !isAllowedVerificationUri(result.verificationUri)) ||
            url.protocol !== 'https:' ||
            url.host !== target.host ||
            url.username ||
            url.password
          )
            throw new CollaborationAuthFailure('sign-in-failed');
          this.view.phase = 'device';
          this.view.device = { userCode: result.userCode, verificationUri: result.verificationUri };
          this.deadline = Date.now() + result.expiresIn * 1000;
          this.publish();
          this.poll(
            revision,
            typeof result.interval === 'number' &&
              Number.isFinite(result.interval) &&
              result.interval > 0
              ? Math.max(2000, result.interval * 1000)
              : 5000,
          );
          return;
        }
      }
      await this.readAccount(revision);
      if (!this.valid(revision)) return;
      if (action.type === 'confirm') {
        const user = this.view.user;
        if (!user) throw new CollaborationAuthFailure('identity-mismatch');
        const identity: PrincipalIdentity = { ...this.view.target, externalUserId: user.id };
        if (!consented || !identitiesEqual(identity, consented))
          throw new CollaborationAuthFailure('identity-mismatch');
        const selected = await this.client.select(identity);
        if (!this.valid(revision)) return;
        if (!selected.principal.identity || !identitiesEqual(identity, selected.principal.identity))
          throw new CollaborationAuthFailure('identity-mismatch');
        this.ended = true;
        clearTimeout(this.timer);
        this.deps.finish({
          kind: 'ready',
          prepared: {
            attempt: this.deps.attempt,
            identity,
            login: user.login,
            invitation: this.view.request,
            local: this.deps.local,
            allowed: () => {
              const policy = this.deps.policy?.() ?? this.policy;
              return (
                this.deps.attempt.current() &&
                policy.multiplayer &&
                (identity.provider !== 'gitlab' || policy.gitlab)
              );
            },
          },
        });
      }
    } catch (error) {
      if (this.ended || revision !== this.revision) return;
      void this.stopFlow();
      this.view.phase = 'error';
      this.view.error = failureCode(error);
      this.publish();
    }
  }
  private async readAccount(revision: number) {
    this.guard();
    const status = await this.client.status(this.view.target);
    if (!this.valid(revision)) return;
    this.view.requestedScopes = status.requestedScopes;
    this.view.grantedScopes = status.grantedScopes;
    this.view.deviceGrantSupported = status.deviceGrantSupported;
    this.view.user = null;
    if (status.isConfigured) {
      const { user } = await this.client.user(this.view.target);
      if (!this.valid(revision)) return;
      if (
        !user ||
        typeof user.id !== 'string' ||
        !user.id ||
        typeof user.login !== 'string' ||
        !user.login
      )
        throw new CollaborationAuthFailure('identity-mismatch');
      this.view.user = user;
      const pin = this.view.request.pinIdentity;
      if (pin && !identitiesEqual(pin, { ...this.view.target, externalUserId: user.id }))
        throw new CollaborationAuthFailure('identity-mismatch');
      if (
        status.configuredButNeedsUpdate ||
        (status.grantedScopes !== null &&
          !status.grantedScopes.includes(this.view.target.provider === 'github' ? 'gist' : 'api'))
      )
        throw new CollaborationAuthFailure('scope-missing');
    }
    this.view.phase = 'account';
    this.view.device = undefined;
    this.publish();
  }
  private poll(revision: number, interval: number) {
    this.timer = setTimeout(() => {
      void (async () => {
        if (!this.valid(revision)) {
          if (!this.ended) this.invalidate();
          return;
        }
        try {
          this.guard();
          const status = await this.client.status(this.view.target);
          if (!this.valid(revision)) return;
          if (status.deviceFlow?.status === 'pending') {
            if (Date.now() >= this.deadline) throw new CollaborationAuthFailure('sign-in-failed');
            this.poll(revision, interval);
            return;
          }
          if (
            !status.isConfigured ||
            ['denied', 'expired', 'error'].includes(status.deviceFlow?.status ?? '')
          )
            throw new CollaborationAuthFailure('sign-in-failed');
          this.flowId = undefined;
          await this.readAccount(revision);
        } catch (error) {
          if (!this.valid(revision)) return;
          void this.stopFlow();
          this.view.phase = 'error';
          this.view.error = failureCode(error);
          this.publish();
        }
      })();
    }, interval);
  }
}
