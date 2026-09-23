import { buildQuestions, questionKey, RUBRIC } from './rubric.ts';
import type { ScoreQuestion, Target } from './rubric.ts';

/** Pinned from https://docs.typesafe.ai/models.md on 2026-09-23. */
export const DEFAULT_MODEL = 'jev-1.13.0';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MAX_RETRIES = 5;
const MAX_DELAY_MS = 10_000;
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
}

export interface JudgeOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
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
  questions: Record<string, ScoreQuestion>,
): Judgment {
  if (!record(value)) invalidResponse();
  const { model: actualModel, answers, usage } = value;
  if (
    typeof actualModel !== 'string' ||
    !/^jev-\d+\.\d+\.\d+$/.test(actualModel) ||
    (model !== 'jev-latest' && model !== 'jev-preview' && actualModel !== model) ||
    !record(answers) ||
    !sameKeys(answers, Object.keys(questions)) ||
    !record(usage) ||
    !Number.isSafeInteger(usage.input_tokens) ||
    !Number.isSafeInteger(usage.output_tokens) ||
    !inRange(usage.input_tokens, 0, Number.MAX_SAFE_INTEGER) ||
    !inRange(usage.output_tokens, 0, Number.MAX_SAFE_INTEGER)
  )
    invalidResponse();

  const entries: Array<[string, TargetScore]> = [];
  for (const target of targets) {
    const dimensions: Record<string, DimensionScore> = {};
    let weightedScore = 0;
    let weight = 0;
    let confidence = 1;
    for (const [dimension, rubric] of Object.entries(RUBRIC)) {
      const key = questionKey(target.id, dimension);
      const answer = validateAnswer(answers[key], questions[key]!);
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
  };
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const header = response?.headers.get('retry-after');
  if (header !== null && header !== undefined) {
    const seconds = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(ms)) return Math.min(MAX_DELAY_MS, Math.max(0, ms));
  }
  return Math.min(MAX_DELAY_MS, 250 * 2 ** attempt);
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
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 2;
  if (
    typeof options.apiKey !== 'string' ||
    !options.apiKey.trim() ||
    /[\r\n]/.test(options.apiKey) ||
    !/^(?:jev-\d+\.\d+\.\d+|jev-latest|jev-preview)$/.test(model) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > MAX_RETRIES
  )
    throw new Error('Invalid Jev configuration.');
  if (targets.length === 0) throw new Error('Jev requires at least one target.');
  const questions = buildQuestions(targets);
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
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response | undefined;
    let payload: unknown;
    try {
      response = await request(ENDPOINT, {
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
        await sleep(retryDelay(undefined, attempt));
        continue;
      }
      if (error instanceof SyntaxError) invalidResponse();
      throw new Error('Jev request failed due to a transport error or timeout.');
    }
    if (response.ok) return validateResponse(payload, model, targets, questions);
    // Discard error bodies without reading or echoing potentially sensitive content.
    try {
      await response.body?.cancel();
    } catch {
      /* Best-effort connection cleanup. */
    }
    if (!TRANSIENT_STATUSES.has(response.status) || attempt === retries) {
      throw new Error(`Jev request failed (HTTP ${response.status}).`);
    }
    await sleep(retryDelay(response, attempt));
  }
  throw new Error('Jev retry limit reached.');
}
