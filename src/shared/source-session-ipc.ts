/** Prepared unregistered main/preload contract. Identity labels are not source authority. */
interface PreparedSourceBinding {
  readonly scope: Readonly<{
    backendId: string;
    workspaceId: string;
    noteId: string;
    noteInstanceId: string;
  }>;
  readonly snapshotId: string;
  readonly sourceRevision: string;
  readonly primitive: 'diff' | 'mermaid';
  readonly nativeId: string;
  readonly ownerRef: string;
  readonly sourceRef: string;
  /** Preserve original daemon spelling; never normalize or extend it. */
  readonly sourceExpiresAt: string;
}

export interface PreparedSourceStamp {
  readonly ownerId: string;
  readonly daemonIncarnation: string;
  /** Canonical unsigned decimal representation of the captured main-local socket epoch. */
  readonly connectionEpoch: string;
  readonly navigationGeneration: number;
  readonly documentGeneration: number;
}
export interface PreparedSourceIdentity extends PreparedSourceStamp {
  readonly binding: PreparedSourceBinding;
}

export type PreparedSourceRead = Readonly<
  {
    readonly maxItems: 1;
    readonly maxWireBytes: number;
  } & (
    | { readonly kind: 'context'; readonly contextRef: string }
    | { readonly kind: 'metadata'; readonly ref: string; readonly cursor?: string }
  )
>;
type PreparedSourceDisposition = 'consume' | 'discard';
export interface PreparedSourceRelease extends PreparedSourceStamp {
  readonly kind: 'released';
  readonly sequence: number;
  readonly disposition: PreparedSourceDisposition;
}
export interface PreparedSourceDelivery {
  readonly identity: PreparedSourceIdentity;
  readonly sequence: number;
  /** Renderer must validate page semantics against identity.binding before consumption. */
  readonly page: unknown;
  current(): boolean;
  /** Immediately bars local adoption. First disposition wins; repeated calls return SAME Promise.
   * An acknowledgement is only this delivery's logical release, not daemon/transport settlement. */
  release(disposition: PreparedSourceDisposition): Promise<PreparedSourceRelease>;
}
export interface PreparedSourceSession {
  readonly identity: PreparedSourceIdentity;
  current(): boolean;
  /** At most one request/result/consumer obligation; next read requires known release acknowledgement. */
  read(request: PreparedSourceRead): Promise<PreparedSourceDelivery>;
  /** Synchronously bars local adoption. Main learns cancellation at its actual IPC handler. */
  cancel(): void;
}
