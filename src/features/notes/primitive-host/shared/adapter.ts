import type { HostHandshake } from './contract';

/** Native adapter contract; all complete source/AST/DOM stays in this renderer. */
export interface NativeConstructionContext {
  job: HostHandshake;
  root: HTMLElement;
  signal: AbortSignal;
  io: {
    /** One sequential bounded source stream, acquired from the frozen job resource. */
    source: AsyncIterable<string>;
    /** UTF-8 encoded record <=16KiB. Await each ACK before allocating/sending another. */
    append(record: string): Promise<void>;
    /** Last bounded manifest record; private seal occurs only after construct resolves. */
    seal(manifest: string): Promise<void>;
    /** Observations, NOT a reservation or physical peak-heap claim. */
    reportCosts(costs: { peakDomNodes?: number; native?: Record<string, number> }): void;
  };
}
export interface NativeConstructionAdapter {
  construct(context: NativeConstructionContext): Promise<void>;
  dispose(): void;
}
