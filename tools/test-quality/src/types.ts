export interface Config {
  include: string[];
  exclude: string[];
  aliases: Record<string, string>;
  maxContextChars: number;
  maxFragments: number;
  maxDepth: number;
}

export interface Finding {
  rule: 'nullish-equality' | 'empty-every' | 'fixture-only-value' | 'fixture-owned-layout';
  certainty: 'review';
  file: string;
  line: number;
  code: string;
  message: string;
}

export interface Target {
  id: string;
  kind: 'file' | 'test' | 'assertion';
  name: string;
  file: string;
  line: number;
  endLine: number;
  code: string;
  parentId?: string;
  status: 'active' | 'skipped' | 'todo' | 'conditional';
  findings?: Finding[];
}

export interface Fragment {
  file: string;
  line: number;
  endLine: number;
  code: string;
  reason: string;
  priority?: number;
  required?: boolean;
}

export interface Trace {
  id: string;
  version: string;
  file: string;
  targets: Target[];
  fragments: Fragment[];
  warnings: string[];
  dependencies: Record<string, string>;
  evidence?: EvidenceCompleteness;
}

export interface Analysis {
  traces: Trace[];
  dependencies: Record<string, string>;
  warnings: string[];
}

export interface Dimension {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface Score {
  overall: number;
  quality?: number;
  criticality?: number;
  criticalityConfidence?: number;
  confidence: number;
  dimensions: Record<string, Dimension>;
}

export interface Judgment {
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  answers: Record<string, unknown>;
  scores: Record<string, Score>;
  reviews?: Record<string, ReviewDecision>;
}

export interface RunRow {
  id: string;
  started: string;
  finished: string | null;
  status: string;
  options: string;
}

export interface ResultRow {
  target: Target;
  traceId: string;
  evaluationId: number | null;
  score: Score | null;
  model: string | null;
  warnings: string[];
  error: string | null;
  cached: boolean;
  decision?: ReviewDecision | null;
  evidence?: EvidenceCompleteness | null;
}

export interface EvidenceCompleteness {
  completeness: 'bounded' | 'partial' | 'unknown';
  omissions: string[];
}
export type Disposition =
  'keep' | 'strengthen' | 'consolidate' | 'remove' | 'insufficient-evidence' | 'retire-skipped';
export interface ReviewDecision {
  disposition: Disposition;
  proposed?: string;
  rationale: string;
  evidenceRefs: string[];
  evidenceLocations?: Record<string, string>;
  counterexample: string;
  confidence: number;
  evidence: EvidenceCompleteness;
  policyVersion: string;
}
