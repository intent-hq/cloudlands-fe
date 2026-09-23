export interface Config {
  include: string[];
  exclude: string[];
  aliases: Record<string, string>;
  maxContextChars: number;
  maxFragments: number;
  maxDepth: number;
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
}

export interface Fragment {
  file: string;
  line: number;
  endLine: number;
  code: string;
  reason: string;
}

export interface Trace {
  id: string;
  version: string;
  file: string;
  targets: Target[];
  fragments: Fragment[];
  warnings: string[];
  dependencies: Record<string, string>;
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
  confidence: number;
  dimensions: Record<string, Dimension>;
}

export interface Judgment {
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  answers: Record<string, unknown>;
  scores: Record<string, Score>;
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
}
