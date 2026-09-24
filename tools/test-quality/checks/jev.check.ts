import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { DEFAULT_MODEL, judge } from '../src/jev.ts';
import { buildQuestions, questionKey, RUBRIC, RUBRIC_VERSION } from '../src/rubric.ts';

const targets = [{ id: 'test:17', kind: 'test' }];
const state = {
  targets: [{ ...targets[0], code: 'expect(save(input)).toEqual(expected)' }],
};
const apiKey = 'check-only-secret';

// These are mock service answers, not results calculated by the production scorer.
const observations = {
  criticalDefectPrevention: {
    score: 3,
    confidence: 1,
    probabilities: [0, 0, 0, 1, 0],
  },
  relevance: { score: 4, confidence: 1, probabilities: [0, 0, 0, 0, 1] },
  oracleStrength: {
    score: 1.5,
    confidence: 0.25,
    probabilities: [0, 0.5, 0.5, 0, 0],
  },
  behavioralValue: { score: 2, confidence: 1, probabilities: [0, 0, 1, 0, 0] },
  reliability: { score: 0, confidence: 1, probabilities: [1, 0, 0, 0, 0] },
};

function serviceResponse(questions = buildQuestions(targets)) {
  return {
    model: 'jev-1.13.0',
    usage: { input_tokens: 123, output_tokens: 45 },
    answers: Object.fromEntries(
      Object.entries(questions).map(([key, question]) => {
        const [, dimension] = JSON.parse(key) as [string, keyof typeof observations];
        const observation = observations[dimension];
        return [
          key,
          {
            type: 'score',
            score: observation.score,
            confidence: observation.confidence,
            // The API echoes the request's criteria as a numbered legend.
            legend: Object.fromEntries(
              question.criteria.map((description, index) => [index, description]),
            ),
            probabilities: Object.fromEntries(
              observation.probabilities.map((probability, index) => [index, probability]),
            ),
          },
        ];
      }),
    ),
  };
}

function respond(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

test('routes the Gateway Jev alias with the Gateway credential', async () => {
  const raw = serviceResponse();
  raw.model = 'jev';
  const result = await judge(state, targets, {
    apiKey: 'gateway-check-key',
    provider: 'vercel',
    fetch: async (url, init) => {
      assert.equal(url, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
      assert.equal(init?.redirect, 'manual');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer gateway-check-key');
      assert.deepEqual(JSON.parse(init?.body as string), {
        model: 'jev',
        state,
        questions: buildQuestions(targets),
      });
      return respond(raw);
    },
  });
  assert.equal(result.model, 'jev');
  assert.equal(result.scores['test:17']?.quality, 53.125);
});

test('sends the documented HTTP request and computes independently known weighted scores', async () => {
  let calls = 0;
  const raw = serviceResponse();
  const result = await judge(state, targets, {
    apiKey,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'manual');
      assert.deepEqual(init?.headers, {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      });
      assert.ok(init?.signal instanceof AbortSignal);
      const request = JSON.parse(init?.body as string);
      assert.equal(request.model, 'jev-1.13.0');
      assert.deepEqual(request.state, state);
      assert.deepEqual(request.questions, buildQuestions(targets));
      return respond(raw);
    },
  });
  assert.equal(calls, 1);
  assert.equal(DEFAULT_MODEL, 'jev-1.13.0');
  assert.equal(result.model, 'jev-1.13.0');
  assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 45 });
  assert.deepEqual(result.answers, raw.answers);
  assert.equal(result.scores['test:17']?.overall, 53.125);
  assert.equal(result.scores['test:17']?.quality, 53.125);
  assert.equal(result.scores['test:17']?.criticality, 75);
  assert.equal(result.scores['test:17']?.confidence, 0.25);
  assert.deepEqual(
    Object.values(result.scores['test:17']!.dimensions).map((value) => value.score),
    [75, 100, 37.5, 50, 0],
  );
  assert.deepEqual(result.scores['test:17']!.dimensions.oracleStrength?.probabilities, {
    '0': 0,
    '1': 0.5,
    '2': 0.5,
    '3': 0,
    '4': 0,
  });
});

test('builds five atomic questions per target with model-visible IDs and independent arrays', () => {
  const selected = [
    { id: 'a:b', kind: 'assertion' },
    { id: 'a', kind: 'file' },
  ];
  const questions = buildQuestions(selected);
  assert.equal(Object.keys(questions).length, 10);
  assert.ok(RUBRIC_VERSION.length > 0);
  for (const target of selected) {
    for (const dimension of Object.keys(RUBRIC)) {
      const question = questions[questionKey(target.id, dimension)]!;
      assert.equal(question.type, 'score');
      assert.equal(question.criteria.length, 5);
      // IDs must occur in inference-visible text: question keys are never model-visible.
      assert.ok(
        question.instructions.includes(
          `state.targets whose id equals ${JSON.stringify(target.id)}`,
        ),
      );
    }
  }
  questions[questionKey('a:b', 'relevance')]!.criteria[0] = 'changed by caller';
  assert.notEqual(questions[questionKey('a', 'relevance')]!.criteria[0], 'changed by caller');
  assert.notEqual(RUBRIC.relevance.criteria[0], 'changed by caller');
  assert.throws(() =>
    buildQuestions([
      { id: 'a', kind: 'test' },
      { id: 'a', kind: 'test' },
    ]),
  );
});

test('criticality and its uncertainty cannot change quality or quality confidence', async () => {
  for (const criticality of [0, 4]) {
    const raw = serviceResponse();
    const answer = raw.answers[questionKey('test:17', 'criticalDefectPrevention')]!;
    answer.score = criticality;
    answer.confidence = 0.01;
    answer.probabilities = Object.fromEntries(
      [0, 1, 2, 3, 4].map((level) => [level, Number(level === criticality)]),
    );
    const result = await judge(state, targets, {
      apiKey,
      fetch: async () => respond(raw),
    });
    const score = result.scores['test:17']!;
    assert.equal(score.quality, 53.125);
    assert.equal(score.confidence, 0.25);
    assert.equal(score.criticality, criticality * 25);
    assert.equal(score.criticalityConfidence, 0.01);
  }
});

test('accepts independently rounded live Jev scores without altering raw distributions', async () => {
  const raw = serviceResponse();
  const behavioralKey = questionKey('test:17', 'behavioralValue');
  // Sanitized live response: rounded probabilities imply 2.27, but score is 2.25.
  raw.answers[behavioralKey]!.score = 2.25;
  raw.answers[behavioralKey]!.confidence = 0.74;
  raw.answers[behavioralKey]!.probabilities = {
    '0': 0,
    '1': 0.02,
    '2': 0.72,
    '3': 0.23,
    '4': 0.03,
  };
  const criticalKey = questionKey('test:17', 'criticalDefectPrevention');
  // A second live answer differs at the former 0.01 floating-point boundary.
  raw.answers[criticalKey]!.score = 1.62;
  raw.answers[criticalKey]!.probabilities = {
    '0': 0.17,
    '1': 0.27,
    '2': 0.38,
    '3': 0.14,
    '4': 0.04,
  };
  const result = await judge(state, targets, {
    apiKey,
    fetch: async () => respond(raw),
  });
  assert.equal(result.scores['test:17']!.dimensions.behavioralValue!.score, 56.25);
  assert.equal(result.scores['test:17']!.dimensions.criticalDefectPrevention!.score, 40.5);
  assert.deepEqual(result.answers, raw.answers);
});

test('accepts rounded probability mass and preserves it without normalization', async () => {
  const raw = serviceResponse();
  const key = questionKey('test:17', 'relevance');
  raw.answers[key]!.score = 1;
  raw.answers[key]!.probabilities = {
    '0': 0.33,
    '1': 0.33,
    '2': 0.33,
    '3': 0,
    '4': 0,
  };
  const result = await judge(state, targets, {
    apiKey,
    fetch: async () => respond(raw),
  });
  assert.equal(result.scores['test:17']!.dimensions.relevance!.score, 25);
  assert.deepEqual(
    result.scores['test:17']!.dimensions.relevance!.probabilities,
    raw.answers[key]!.probabilities,
  );
});

test('handles prototype-like target IDs without losing or confusing scores', async () => {
  const selected = [
    { id: '__proto__', kind: 'assertion' },
    { id: 'constructor', kind: 'test' },
  ];
  const result = await judge({ targets: selected }, selected, {
    apiKey,
    fetch: async () => respond(serviceResponse(buildQuestions(selected))),
  });
  assert.deepEqual(Object.keys(result.scores), ['__proto__', 'constructor']);
  assert.equal(result.scores.__proto__?.overall, 53.125);
  assert.ok(Object.values(result.scores).every((score) => score.overall === 53.125));
});

type Fixture = ReturnType<typeof serviceResponse>;
const firstKey = questionKey('test:17', 'criticalDefectPrevention');
const corruptions: Array<[string, (fixture: Fixture) => void]> = [
  [
    'mass beyond rounding bound',
    (value) => {
      value.answers[firstKey]!.probabilities['0'] = 0.03;
    },
  ],
  [
    'score beyond rounding bound',
    (value) => {
      value.answers[firstKey]!.score = 3.06;
    },
  ],
  [
    'wrong model',
    (value) => {
      value.model = 'jev-0.0.1';
    },
  ],
  [
    'unresolved model alias',
    (value) => {
      value.model = 'jev-latest';
    },
  ],
  [
    'negative token count',
    (value) => {
      value.usage.input_tokens = -1;
    },
  ],
  [
    'fractional token count',
    (value) => {
      value.usage.output_tokens = 0.5;
    },
  ],
  [
    'missing usage',
    (value) => {
      Reflect.deleteProperty(value, 'usage');
    },
  ],
  [
    'missing answer',
    (value) => {
      delete value.answers[firstKey];
    },
  ],
  [
    'extra answer',
    (value) => {
      value.answers.extra = value.answers[firstKey]!;
    },
  ],
  [
    'wrong answer type',
    (value) => {
      value.answers[firstKey]!.type = 'choice';
    },
  ],
  [
    'out-of-range score',
    (value) => {
      value.answers[firstKey]!.score = 5;
    },
  ],
  [
    'out-of-range confidence',
    (value) => {
      value.answers[firstKey]!.confidence = -0.1;
    },
  ],
  [
    'missing legend',
    (value) => {
      Reflect.deleteProperty(value.answers[firstKey]!, 'legend');
    },
  ],
  [
    'wrong legend',
    (value) => {
      value.answers[firstKey]!.legend['0'] = 'different rubric';
    },
  ],
  [
    'missing level',
    (value) => {
      delete value.answers[firstKey]!.probabilities['0'];
    },
  ],
  [
    'extra level',
    (value) => {
      value.answers[firstKey]!.probabilities['5'] = 0;
    },
  ],
  [
    'negative probability',
    (value) => {
      value.answers[firstKey]!.probabilities['0'] = -0.1;
    },
  ],
  [
    'bad probability mass',
    (value) => {
      value.answers[firstKey]!.probabilities['0'] = 0.5;
    },
  ],
  [
    'score contradicts distribution',
    (value) => {
      value.answers[firstKey]!.score = 1;
    },
  ],
];

for (const [name, corrupt] of corruptions) {
  test(`rejects ${name} without retrying or exposing the response`, async () => {
    let calls = 0;
    const raw = serviceResponse();
    corrupt(raw);
    await assert.rejects(
      judge(state, targets, {
        apiKey,
        fetch: async () => {
          calls++;
          return respond({ ...raw, debug: apiKey });
        },
      }),
      { message: 'Jev returned an invalid response.' },
    );
    assert.equal(calls, 1);
  });
}

test('preserves the resolved version when a documented alias is explicitly requested', async () => {
  const result = await judge(state, targets, {
    apiKey,
    model: 'jev-latest',
    fetch: async () => respond(serviceResponse()),
  });
  assert.equal(result.model, 'jev-1.13.0');
});

for (const status of [301, 400, 401, 403, 404, 422, 501]) {
  test(`does not retry permanent HTTP ${status} failures or leak their body`, async () => {
    let calls = 0;
    await assert.rejects(
      judge(state, targets, {
        apiKey,
        fetch: async () => {
          calls++;
          return respond({ error: apiKey }, status);
        },
      }),
      { message: `Jev request failed (HTTP ${status}).` },
    );
    assert.equal(calls, 1);
  });
}

for (const status of [408, 425, 429, 500, 502, 503, 504, 529]) {
  test(`retries transient HTTP ${status} and then succeeds`, async () => {
    let calls = 0;
    const result = await judge(state, targets, {
      apiKey,
      fetch: async () =>
        ++calls === 1 ? respond({}, status, { 'Retry-After': '0' }) : respond(serviceResponse()),
    });
    assert.equal(calls, 2);
    assert.equal(result.scores['test:17']?.overall, 53.125);
  });
}

test('stops at the configured retry bound', async () => {
  let calls = 0;
  await assert.rejects(
    judge(state, targets, {
      apiKey,
      retries: 2,
      fetch: async () => {
        calls++;
        return respond({}, 529, { 'Retry-After': '0' });
      },
    }),
    { message: 'Jev request failed (HTTP 529).' },
  );
  assert.equal(calls, 3);
});

for (const [name, header, delay] of [
  ['seconds', '2', 2000],
  ['HTTP date', 'Wed, 23 Sep 2026 22:00:02 GMT', 2000],
  ['bounded long delay', '999999', 10_000],
] as const) {
  test(`honors Retry-After ${name}`, async (context) => {
    context.mock.timers.enable({
      apis: ['setTimeout', 'Date'],
      now: Date.parse('2026-09-23T22:00:00Z'),
    });
    let calls = 0;
    const pending = judge(state, targets, {
      apiKey,
      fetch: async () =>
        ++calls === 1 ? respond({}, 429, { 'Retry-After': header }) : respond(serviceResponse()),
    });
    await setImmediate();
    context.mock.timers.tick(delay - 1);
    await setImmediate();
    assert.equal(calls, 1);
    context.mock.timers.tick(1);
    assert.equal((await pending).scores['test:17']?.overall, 53.125);
    assert.equal(calls, 2);
  });
}

test('retries a network failure without leaking the original exception', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const pending = judge(state, targets, {
    apiKey,
    fetch: async () => {
      if (++calls === 1) throw new TypeError(apiKey);
      return respond(serviceResponse());
    },
  });
  await setImmediate();
  context.mock.timers.tick(250);
  await pending;
  assert.equal(calls, 2);
});

test('retries a transport timeout and sanitizes exhausted network errors', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const pending = judge(state, targets, {
    apiKey,
    fetch: async () => {
      if (++calls === 1) throw new DOMException(apiKey, 'TimeoutError');
      return respond(serviceResponse());
    },
  });
  await setImmediate();
  context.mock.timers.tick(250);
  await pending;
  assert.equal(calls, 2);
  await assert.rejects(
    judge(state, targets, {
      apiKey,
      retries: 0,
      fetch: async () => {
        throw new TypeError(apiKey);
      },
    }),
    { message: 'Jev request failed due to a transport error or timeout.' },
  );
});

test('timeouts abort the request and sanitize transport errors', async () => {
  // Keep the process alive: AbortSignal.timeout uses an unreferenced native timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    let signal: AbortSignal | undefined;
    await assert.rejects(
      judge(state, targets, {
        apiKey,
        timeoutMs: 1,
        retries: 0,
        fetch: async (_url, init) =>
          new Promise((_resolve, reject) => {
            signal = init!.signal as AbortSignal;
            signal.addEventListener('abort', () => reject(new Error(apiKey)), {
              once: true,
            });
          }),
      }),
      { message: 'Jev request failed due to a transport error or timeout.' },
    );
    assert.equal(signal?.aborted, true);
  } finally {
    clearInterval(keepAlive);
  }
});

test('does not retry malformed JSON or arbitrary application exceptions', async () => {
  for (const malformedJson of [true, false]) {
    let calls = 0;
    await assert.rejects(
      judge(state, targets, {
        apiKey,
        fetch: async () => {
          calls++;
          if (!malformedJson) throw new Error(apiKey);
          return new Response(`not JSON ${apiKey}`);
        },
      }),
      (error: Error) => !error.message.includes(apiKey),
    );
    assert.equal(calls, 1);
  }
});

test('rejects invalid configuration and unserializable state before sending requests', async () => {
  let calls = 0;
  const fetchMock: typeof fetch = async () => {
    calls++;
    return respond(serviceResponse());
  };
  for (const override of [
    { retries: -1 },
    { retries: 6 },
    { timeoutMs: 0 },
    { timeoutMs: Infinity },
    { apiKey: '' },
    { model: 'arbitrary' },
  ]) {
    await assert.rejects(judge(state, targets, { apiKey, fetch: fetchMock, ...override }));
  }
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(judge(circular, targets, { apiKey, fetch: fetchMock }));
  await assert.rejects(judge(null, targets, { apiKey, fetch: fetchMock }));
  await assert.rejects(judge(state, [], { apiKey, fetch: fetchMock }));
  assert.equal(calls, 0);
});
