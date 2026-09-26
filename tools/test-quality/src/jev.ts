import { reviewQuestions, decide, isReviewState } from './decisions.ts';
import type { ChoiceQuestion, ChoiceAnswer } from './decisions.ts';
import type { ReviewDecision } from './types.ts';
import { buildQuestions, questionKey, RUBRIC } from './rubric.ts';
import type { ScoreQuestion, Target } from './rubric.ts';

/** Pinned from https://docs.typesafe.ai/models.md on 2026-09-23. */
export const DEFAULT_MODEL = 'jev-1.13.0';
export const DEFAULT_GATEWAY_MODEL = 'jev';
export const ENDPOINTS = {
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  vercel: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
};
export type JevProvider = keyof typeof ENDPOINTS;

export class JevHttpError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, retryAfterMs?: number) {
    super(`Jev request failed (HTTP ${status}).`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
const MAX_RETRIES = 5;
const MAX_DELAY_MS = 60_000;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
// Jev serializes score/probabilities independently to two decimals (observed live).
const ROUNDING_HALF_UNIT = 0.005;
const FLOAT_EPSILON = 1e-9;

function sleep(delayMs: number): Promise<void> {
  // Resolve the global timer at call time so node:test can control retry delays.
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export interface DimensionScore {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface TargetScore {
  overall: number;
  quality: number;
  criticality: number;
  criticalityConfidence: number;
  /** Minimum dimension confidence: a conservative review signal, not joint probability. */
  confidence: number;
  dimensions: Record<string, DimensionScore>;
}

export interface Judgment {
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  answers: Record<string, unknown>;
  scores: Record<string, TargetScore>;
  reviews?: Record<string, ReviewDecision>;
}

export interface JudgeOptions {
  apiKey: string;
  provider?: JevProvider;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  beforeRequest?: () => Promise<void>;
  onBackoff?: (delayMs: number) => void;
}

function invalidResponse(): never {
  // Never include response bodies, model text, transport errors, or request headers.
  throw new Error('Jev returned an invalid response.');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function sameKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function validateAnswer(value: unknown, question: ScoreQuestion): DimensionScore {
  if (!record(value) || value.type !== 'score') invalidResponse();
  const { score, confidence, probabilities, legend } = value;
  const top = question.criteria.length - 1;
  const levels = question.criteria.map((_, index) => String(index));
  if (
    !inRange(score, 0, top) ||
    !inRange(confidence, 0, 1) ||
    !record(probabilities) ||
    !record(legend) ||
    !sameKeys(probabilities, levels) ||
    !sameKeys(legend, levels)
  )
    invalidResponse();
  let mass = 0;
  let expected = 0;
  for (const level of levels) {
    const probability = probabilities[level];
    if (!inRange(probability, 0, 1) || legend[level] !== question.criteria[Number(level)]) {
      invalidResponse();
    }
    mass += probability;
    expected += Number(level) * probability;
  }
  // Each serialized probability can differ by 0.005 from the underlying value;
  // the independently rounded score contributes another 0.005. Preserve the
  // returned numbers rather than normalizing them or recomputing the score.
  const massTolerance = levels.length * ROUNDING_HALF_UNIT + FLOAT_EPSILON;
  const scoreTolerance = (1 + (top * (top + 1)) / 2) * ROUNDING_HALF_UNIT + FLOAT_EPSILON;
  if (Math.abs(mass - 1) > massTolerance || Math.abs(expected - score) > scoreTolerance) {
    invalidResponse();
  }
  return {
    score: (score / top) * 100,
    confidence,
    probabilities: probabilities as Record<string, number>,
  };
}

function validateResponse(
  value: unknown,
  model: string,
  targets: Target[],
  questions: Record<string, ScoreQuestion | ChoiceQuestion>,
  state: unknown,
): Judgment {
  if (!record(value)) invalidResponse();
  const { model: actualModel, answers, usage } = value;
  if (
    typeof actualModel !== 'string' ||
    (!(model === 'jev' && actualModel === 'jev') && !/^jev-\d+\.\d+\.\d+$/.test(actualModel)) ||
    (!['jev', 'jev-latest', 'jev-preview'].includes(model) && actualModel !== model) ||
    !record(answers) ||
    !sameKeys(answers, Object.keys(questions)) ||
    !record(usage) ||
    !Number.isSafeInteger(usage.input_tokens) ||
    !Number.isSafeInteger(usage.output_tokens) ||
    !inRange(usage.input_tokens, 0, Number.MAX_SAFE_INTEGER) ||
    !inRange(usage.output_tokens, 0, Number.MAX_SAFE_INTEGER)
  )
    invalidResponse();

  const choices: Record<string, ChoiceAnswer> = {};
  for (const [key, question] of Object.entries(questions))
    if (question.type === 'choice') {
      const a = answers[key];
      const keys = Object.keys(question.criteria);
      if (
        !record(a) ||
        a.type !== 'choice' ||
        typeof a.choice !== 'string' ||
        !keys.includes(a.choice) ||
        !inRange(a.confidence, 0, 1) ||
        !record(a.probabilities) ||
        !sameKeys(a.probabilities, keys)
      )
        invalidResponse();
      const probabilities = a.probabilities as Record<string, number>;
      if (
        !Object.values(probabilities).every((p) => inRange(p, 0, 1)) ||
        Math.abs(Object.values(probabilities).reduce((x, y) => x + y, 0) - 1) >
          keys.length * ROUNDING_HALF_UNIT + FLOAT_EPSILON ||
        Object.values(probabilities).some((p) => p > probabilities[a.choice as string] + 0.01)
      )
        invalidResponse();
      choices[key] = a as unknown as ChoiceAnswer;
    }
  const entries: Array<[string, TargetScore]> = [];
  for (const target of targets) {
    const dimensions: Record<string, DimensionScore> = {};
    let weightedScore = 0;
    let weight = 0;
    let confidence = 1;
    for (const [dimension, rubric] of Object.entries(RUBRIC)) {
      const key = questionKey(target.id, dimension);
      const answer = validateAnswer(answers[key], questions[key] as ScoreQuestion);
      dimensions[dimension] = answer;
      weightedScore += answer.score * rubric.weight;
      weight += rubric.weight;
      if (rubric.weight > 0) confidence = Math.min(confidence, answer.confidence);
    }
    const quality = weightedScore / weight;
    entries.push([
      target.id,
      {
        overall: quality,
        quality,
        criticality: dimensions.criticalDefectPrevention!.score,
        criticalityConfidence: dimensions.criticalDefectPrevention!.confidence,
        confidence,
        dimensions,
      },
    ]);
  }
  return {
    model: actualModel,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
    answers,
    scores: Object.fromEntries(entries),
    ...(isReviewState(state)
      ? { reviews: Object.fromEntries(targets.map((t) => [t.id, decide(state, t, choices)])) }
      : {}),
  };
}

function retryDelay(
  response: Response | undefined,
  attempt: number,
  provider: JevProvider,
): number {
  const header = response?.headers.get('retry-after');
  if (header !== null && header !== undefined) {
    const seconds = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, ms);
  }
  const base = provider === 'vercel' ? 5_000 : 1_000;
  return Math.min(MAX_DELAY_MS, base * 2 ** attempt + Math.random() * base);
}

function transientError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    error instanceof TypeError ||
    (error instanceof Error && error.name === 'TimeoutError')
  );
}

export async function judge(
  state: unknown,
  targets: Target[],
  options: JudgeOptions,
): Promise<Judgment> {
  const provider = options.provider ?? 'typesafe';
  const model = options.model ?? (provider === 'vercel' ? DEFAULT_GATEWAY_MODEL : DEFAULT_MODEL);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 2;
  if (
    !Object.hasOwn(ENDPOINTS, provider) ||
    typeof options.apiKey !== 'string' ||
    !options.apiKey.trim() ||
    /[\r\n]/.test(options.apiKey) ||
    !(provider === 'vercel'
      ? model === 'jev'
      : /^(?:jev-\d+\.\d+\.\d+|jev-latest|jev-preview)$/.test(model)) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > MAX_RETRIES
  )
    throw new Error('Invalid Jev configuration.');
  if (targets.length === 0) throw new Error('Jev requires at least one target.');
  const questions = { ...buildQuestions(targets), ...reviewQuestions(state, targets) };
  let body: string;
  try {
    if (state === null || (typeof state !== 'string' && typeof state !== 'object')) {
      throw new Error();
    }
    body = JSON.stringify({ state, model, questions });
  } catch {
    throw new Error('Jev state must be JSON serializable text, an object, or an array.');
  }
  const request = options.fetch ?? globalThis.fetch;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await options.beforeRequest?.();
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response | undefined;
    let payload: unknown;
    try {
      response = await request(ENDPOINTS[provider], {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal,
        redirect: 'manual',
      });
      if (response.ok) payload = await response.json();
    } catch (error) {
      if (transientError(error, signal) && attempt < retries) {
        const delayMs = retryDelay(undefined, attempt, provider);
        options.onBackoff?.(delayMs);
        await sleep(delayMs);
        continue;
      }
      if (error instanceof SyntaxError) invalidResponse();
      throw new Error('Jev request failed due to a transport error or timeout.');
    }
    if (response.ok) return validateResponse(payload, model, targets, questions, state);
    // Discard error bodies without reading or echoing potentially sensitive content.
    try {
      await response.body?.cancel();
    } catch {
      /* Best-effort connection cleanup. */
    }
    const delayMs = TRANSIENT_STATUSES.has(response.status)
      ? retryDelay(response, attempt, provider)
      : undefined;
    if (delayMs !== undefined && delayMs <= MAX_DELAY_MS) options.onBackoff?.(delayMs);
    if (
      !TRANSIENT_STATUSES.has(response.status) ||
      attempt === retries ||
      delayMs! > MAX_DELAY_MS
    ) {
      throw new JevHttpError(response.status, delayMs);
    }
    await sleep(delayMs!);
  }
  throw new Error('Jev retry limit reached.');
}
