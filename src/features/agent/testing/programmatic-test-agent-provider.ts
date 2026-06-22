import {
  BaseAgentProvider,
  type AgentConfig,
  type StreamOptions,
} from '../main/agent-providers/base-provider';
import type { ProviderMessage, ToolCall } from '$shared/types';

export const PROGRAMMATIC_TEST_PROVIDER_ID = 'programmatic-test';

export type ProgrammaticTestStep =
  | { type: 'chunk'; text: string; delayMs?: number }
  | { type: 'contentBlocks'; blocks: ProviderMessage['contentBlocks']; delayMs?: number }
  | { type: 'malformed'; value: unknown; delayMs?: number }
  | { type: 'error'; message: string; delayMs?: number }
  | { type: 'complete'; content?: string; delayMs?: number; metadata?: Record<string, any> }
  | { type: 'hang'; delayMs?: number }
  | { type: 'awaitCompletion'; delayMs?: number };

export interface ProgrammaticTestScript {
  steps?: ProgrammaticTestStep[];
  chunks?: string[];
  chunkDelayMs?: number;
  completionDelayMs?: number;
  response?: string;
  failWith?: string;
  hang?: boolean;
  malformedUpdates?: unknown[];
}

export interface ProgrammaticTestProviderConfig extends AgentConfig {
  programmaticScript?: ProgrammaticTestScript;
}

type ActiveRun = {
  chunks: string[];
  completed: boolean;
  options: StreamOptions;
  resolve: () => void;
  reject: (error: Error) => void;
  releaseAwait?: () => void;
  timers: Set<NodeJS.Timeout>;
};

export function isProgrammaticTestProviderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.TESTING === 'true' ||
    env.NODE_ENV === 'test' ||
    (env.NODE_ENV === 'development' && env.ENABLE_PROGRAMMATIC_TEST_PROVIDER === 'true')
  );
}

export function assertProgrammaticTestProviderEnabled(): void {
  if (!isProgrammaticTestProviderEnabled()) {
    throw new Error(
      'Programmatic test provider is only available when TESTING=true, NODE_ENV=test, or development with ENABLE_PROGRAMMATIC_TEST_PROVIDER=true',
    );
  }
}

export function createProgrammaticTestScript(
  script: ProgrammaticTestScript = {},
): ProgrammaticTestStep[] {
  if (script.steps) return script.steps;

  const steps: ProgrammaticTestStep[] = [];
  const chunks = script.chunks ?? [script.response ?? 'Programmatic test response'];
  for (const [index, text] of chunks.entries()) {
    steps.push({ type: 'chunk', text, delayMs: index === 0 ? 0 : script.chunkDelayMs });
  }
  for (const value of script.malformedUpdates ?? []) {
    steps.push({ type: 'malformed', value });
  }
  if (script.failWith) {
    steps.push({ type: 'error', message: script.failWith });
  } else if (script.hang) {
    steps.push({ type: 'hang' });
  } else {
    steps.push({ type: 'complete', delayMs: script.completionDelayMs });
  }
  return steps;
}

export class ProgrammaticTestAgentProvider extends BaseAgentProvider {
  private activeRun?: ActiveRun;
  private initialized = false;

  constructor(config: ProgrammaticTestProviderConfig) {
    assertProgrammaticTestProviderEnabled();
    super({ ...config, provider: config.provider || PROGRAMMATIC_TEST_PROVIDER_ID });
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    this.initialized = true;
  }

  async sendMessage(
    messages: ProviderMessage[],
    options: StreamOptions = {},
  ): Promise<ProviderMessage> {
    let finalMessage: ProviderMessage | undefined;
    const chunks: string[] = [];
    await this.streamMessage(messages, {
      ...options,
      onChunk: (chunk) => {
        chunks.push(String(chunk));
        options.onChunk?.(chunk);
      },
      onComplete: (message) => {
        finalMessage = message;
        options.onComplete?.(message);
      },
    });
    return finalMessage ?? this.createMessage(chunks.join(''));
  }

  async streamMessage(_messages: ProviderMessage[], options: StreamOptions): Promise<void> {
    this.validateConfig();
    this.initialized = true;
    if (this.activeRun && !this.activeRun.completed) {
      throw new Error('Programmatic test provider already has an active run');
    }

    return new Promise((resolve, reject) => {
      const run: ActiveRun = {
        chunks: [],
        completed: false,
        options,
        resolve,
        reject,
        timers: new Set(),
      };
      this.activeRun = run;
      void this.executeScript(run).catch((error) => this.failRun(run, error));
    });
  }

  async completeActiveRun(content?: string, metadata?: Record<string, any>): Promise<void> {
    const run = this.activeRun;
    if (!run || run.completed) return;
    await this.completeRun(run, this.createMessage(content ?? run.chunks.join(''), metadata));
    run.releaseAwait?.();
  }

  async failActiveRun(error: Error | string): Promise<void> {
    const run = this.activeRun;
    if (!run || run.completed) return;
    this.failRun(run, typeof error === 'string' ? new Error(error) : error);
    run.releaseAwait?.();
  }

  async stop(): Promise<void> {
    const run = this.activeRun;
    if (!run || run.completed) return;
    await this.completeRun(
      run,
      this.createMessage(run.chunks.join(''), { interrupted: true, stopReason: 'cancelled' }),
    );
    run.releaseAwait?.();
    this.emit('interrupted');
  }

  async isAvailable(): Promise<boolean> {
    return isProgrammaticTestProviderEnabled() && this.initialized;
  }

  getInfo(): { name: string; models: string[]; capabilities: string[] } {
    return {
      name: 'Programmatic Test Agent Provider',
      models: ['programmatic-test-model'],
      capabilities: ['streaming', 'delays', 'failures', 'hangs', 'interruptions'],
    };
  }

  async getAvailableModels(): Promise<string[]> {
    return this.getInfo().models;
  }

  protected formatMessages(messages: ProviderMessage[]): ProviderMessage[] {
    return messages;
  }

  protected parseResponse(response: any): ProviderMessage {
    if (typeof response === 'string') return this.createMessage(response);
    if (response?.role) return response as ProviderMessage;
    return this.createMessage(JSON.stringify(response));
  }

  protected validateProviderConfig(): boolean {
    assertProgrammaticTestProviderEnabled();
    return true;
  }

  protected extractToken(chunk: any): string | null {
    if (typeof chunk === 'string') return chunk;
    if (typeof chunk?.text === 'string') return chunk.text;
    return null;
  }

  protected extractToolCall(chunk: any): ToolCall | null {
    if (chunk?.type === 'tool_use' && chunk.name) {
      return {
        id: chunk.id ?? `programmatic-tool-${Date.now()}`,
        name: chunk.name,
        arguments: chunk.input ?? {},
      };
    }
    return null;
  }

  async cleanup(): Promise<void> {
    await this.stop();
    await super.cleanup();
  }

  private async executeScript(run: ActiveRun): Promise<void> {
    const config = this.config as ProgrammaticTestProviderConfig;
    for (const step of createProgrammaticTestScript(config.programmaticScript)) {
      if (run.completed) return;
      if ((step.delayMs ?? 0) > 0) {
        await this.delay(step.delayMs ?? 0, run);
      }
      if (run.completed) return;
      await this.executeStep(run, step);
    }
    if (!run.completed) {
      await this.completeRun(run, this.createMessage(run.chunks.join('')));
    }
  }

  private async executeStep(run: ActiveRun, step: ProgrammaticTestStep): Promise<void> {
    switch (step.type) {
      case 'chunk':
        run.chunks.push(step.text);
        run.options.onToken?.(step.text);
        run.options.onChunk?.(step.text);
        this.emit('chunk', step.text);
        return;
      case 'contentBlocks':
        run.options.onContentBlocks?.(step.blocks ?? []);
        this.emit('contentBlocks', step.blocks ?? []);
        return;
      case 'malformed':
        run.options.onChunk?.(step.value as any);
        this.emit('malformed', step.value);
        return;
      case 'error':
        throw new Error(step.message);
      case 'complete':
        await this.completeRun(
          run,
          this.createMessage(step.content ?? run.chunks.join(''), step.metadata),
        );
        return;
      case 'hang':
      case 'awaitCompletion':
        this.emit(step.type);
        await new Promise<void>((resolve) => {
          run.releaseAwait = resolve;
        });
        return;
    }
  }

  private async completeRun(run: ActiveRun, message: ProviderMessage): Promise<void> {
    if (run.completed) return;
    run.completed = true;
    this.clearRunTimers(run);
    await Promise.resolve(run.options.onComplete?.(message));
    this.activeRun = undefined;
    run.resolve();
  }

  private failRun(run: ActiveRun, error: Error): void {
    if (run.completed) return;
    run.completed = true;
    this.clearRunTimers(run);
    run.options.onError?.(error);
    this.activeRun = undefined;
    run.reject(error);
  }

  private createMessage(content: string, metadata?: Record<string, any>): ProviderMessage {
    return {
      role: 'assistant',
      contentBlocks: content ? [{ type: 'text', text: content }] : [],
      metadata: { provider: PROGRAMMATIC_TEST_PROVIDER_ID, ...metadata },
    };
  }

  private delay(ms: number, run: ActiveRun): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        run.timers.delete(timer);
        resolve();
      }, ms);
      run.timers.add(timer);
    });
  }

  private clearRunTimers(run: ActiveRun): void {
    for (const timer of run.timers) clearTimeout(timer);
    run.timers.clear();
  }
}
