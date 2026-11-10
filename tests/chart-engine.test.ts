import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChartError, generateChartResponse, parseChartResult, chartResponseSchema } from '../chartEngine.ts';
import type { ChartDependencies } from '../chartEngine.ts';

const fixture = () => ({
  chartContent: '- c/c : 합성 증상', diagnosticGuide: '[감별 진단 포인트]\n- 합성 소견',
  matchProbability: '80%', matchReason: '합성 근거', assessmentDisease: '합성 진단',
  treatmentRecommendation: '[최적 치료법 및 타겟]\n- 합성 제안', recommendedTreatmentType: '합성처방',
  consultationFeedback: '음성 녹음이 제공되지 않아 가이드를 생략합니다.', herbsRecipe: [],
});
const env = { OPENAI_API_KEY: 'synthetic-openai', GEMINI_API_KEY: 'synthetic-gemini' };
const completed = (chart: unknown = fixture(), extra: Record<string, any> = {}) => new Response(JSON.stringify({
  status: 'completed', model: 'gpt-6-astra-synthetic-snapshot',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(chart) }] }], ...extra,
}));
const request = (handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch =>
  (async (url, init) => handler(String(url), init!)) as typeof fetch;
const audio = { mimeType: 'audio/wav', data: Buffer.from('RIFF synthetic recording').toString('base64') };
const errorCode = (code: string, status?: number) => (error: unknown) => {
  assert.ok(error instanceof ChartError); assert.equal(error.message, code);
  if (status !== undefined) assert.equal(error.status, status);
  return true;
};

test('Astra preserves the exact original prompt and sends strict schema with stateless medium reasoning', async () => {
  const prompt = '  변경 금지\n원문 프롬프트  ';
  let calls = 0;
  const result = await generateChartResponse(prompt, undefined, 'gpt-astra', {
    env, request: request((url, init) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(init.redirect, 'error');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-openai');
      const body = JSON.parse(String(init.body));
      assert.equal(body.input, prompt);
      assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.store, false);
      assert.deepEqual(body.reasoning, { effort: 'medium' });
      assert.equal(body.max_output_tokens, 16384);
      assert.equal(body.text.verbosity, 'medium');
      assert.deepEqual(body.text.format, { type: 'json_schema', name: 'initial_chart', strict: true, schema: chartResponseSchema });
      return completed();
    }),
    geminiGenerate: async () => { throw Error('must not switch providers'); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ...fixture(), engine: 'gpt-astra', model: 'gpt-6-astra-synthetic-snapshot' });
});

test('all object schema properties are required and extra keys forbidden', () => {
  function inspect(schema: any) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(inspect);
    }
    if (schema.items) inspect(schema.items);
  }
  inspect(chartResponseSchema);
});

test('nullable inapplicable herb fields are removed before legacy recipe calculation', async () => {
  const chart = { ...fixture(), herbsRecipe: [{ 합방_처방: ['합성처방'], 가감_목록: [
    { 약재명: '약재가', 동작: '가', 용량_g: 3, 남길_비율: null },
    { 약재명: '약재나', 동작: '감', 용량_g: null, 남길_비율: 0 },
  ] }] };
  const result = await generateChartResponse('synthetic', undefined, 'gpt-astra', { env, request: request(() => completed(chart)) });
  assert.deepEqual(result.herbsRecipe[0].가감_목록, [
    { 약재명: '약재가', 동작: '가', 용량_g: 3 }, { 약재명: '약재나', 동작: '감', 남길_비율: 0 },
  ]);
});

test('invalid structured fields and incomplete modifier semantics are rejected', () => {
  const invalid = [
    { ...fixture(), chartContent: '' }, { ...fixture(), diagnosticGuide: {} },
    { ...fixture(), treatmentRecommendation: null }, { ...fixture(), inventedField: 'extra' },
    { ...fixture(), herbsRecipe: [{ 합방_처방: '처방', 가감_목록: [] }] },
    ...[
      { 약재명: '약재', 동작: '가', 용량_g: null, 남길_비율: null },
      { 약재명: '약재', 동작: '감', 용량_g: null, 남길_비율: 2 },
      { 약재명: '약재', 동작: '가', 용량_g: -1, 남길_비율: null },
      { 약재명: '약재', 동작: '교체', 용량_g: 1, 남길_비율: null },
      { 약재명: '약재', 동작: '가', 용량_g: 1 },
    ].map(modifier => ({ ...fixture(), herbsRecipe: [{ 합방_처방: ['합성처방'], 가감_목록: [modifier] }] })),
  ];
  for (const value of invalid) assert.throws(() => parseChartResult(JSON.stringify(value), true), errorCode('INVALID_AI_RESPONSE'));
  assert.throws(() => parseChartResult('```json\n' + JSON.stringify(fixture()) + '\n```', true), errorCode('INVALID_AI_RESPONSE'));
  assert.equal(parseChartResult('```json\n' + JSON.stringify(fixture()) + '\n```').chartContent, fixture().chartContent);
});

test('missing key, invalid engine and prompt fail before any API request', async () => {
  const deps: ChartDependencies = { env: {}, request: request(() => { throw Error('must not request'); }) };
  await assert.rejects(generateChartResponse('x', undefined, 'gpt-astra', deps), errorCode('OPENAI_NOT_CONFIGURED', 503));
  await assert.rejects(generateChartResponse('x', undefined, 'gemini', deps), errorCode('GEMINI_NOT_CONFIGURED', 503));
  await assert.rejects(generateChartResponse('x', undefined, 'other', deps), errorCode('INVALID_ENGINE', 400));
  for (const prompt of [undefined, {}, '', '  ']) await assert.rejects(generateChartResponse(prompt, undefined, 'gpt-astra', deps), errorCode('INVALID_PROMPT', 400));
});

test('Astra errors are bounded, never reveal provider bodies and never fall back', async () => {
  const statuses = [[401, 'OPENAI_ACCESS_DENIED', 503], [403, 'OPENAI_ACCESS_DENIED', 503],
    [404, 'ASTRA_UNAVAILABLE', 503], [429, 'QUOTA_EXCEEDED', 429], [500, 'OPENAI_REQUEST_FAILED', 502]] as const;
  for (const [status, code, expectedStatus] of statuses) {
    await assert.rejects(generateChartResponse('x', undefined, 'gpt-astra', {
      env, request: request(() => new Response('secret upstream body', { status })),
      geminiGenerate: async () => { throw Error('must not fall back'); },
    }), errorCode(code, expectedStatus));
  }
  await assert.rejects(generateChartResponse('x', undefined, 'gpt-astra', { env, request: request(() => { throw Error('sensitive connection details'); }) }), errorCode('OPENAI_CONNECTION_FAILED', 504));
  const payloads = [
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'sensitive' }] }] },
    { status: 'completed', output: [] },
  ];
  for (const [i, raw] of payloads.entries()) {
    await assert.rejects(generateChartResponse('x', undefined, 'gpt-astra', { env, request: request(() => new Response(JSON.stringify(raw))) }), errorCode(['INCOMPLETE_AI_RESPONSE', 'AI_REFUSAL', 'EMPTY_AI_RESPONSE'][i]));
  }
});

test('transcription multipart uses languages[] and sends unchanged full transcript separately', async () => {
  const transcript = '  환자: 통증은 6점, 저림은 없습니다.\n원장: 일주일 전부터였나요?  ';
  const calls: string[] = [];
  const result = await generateChartResponse('원문', audio, 'gpt-astra', { env, request: request(async (url, init) => {
    calls.push(url);
    if (url.endsWith('/transcriptions')) {
      const body = init.body as FormData;
      assert.ok(body instanceof FormData);
      assert.equal(body.get('model'), 'gpt-transcribe');
      assert.deepEqual(body.getAll('languages[]'), ['ko']);
      assert.equal(body.has('language'), false);
      assert.equal(body.has('keywords[]'), false);
      assert.equal(new Headers(init.headers).has('content-type'), false, 'fetch must set multipart boundary');
      const file = body.get('file') as File;
      assert.equal(file.name, 'consultation.wav'); assert.equal(file.type, 'audio/wav');
      assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'), audio.data);
      return new Response(JSON.stringify({ text: transcript }));
    }
    const body = JSON.parse(String(init.body));
    assert.equal(body.input[0].content[0].text, '원문');
    assert.equal(body.input[0].content[1].text, `[진료 음성의 원문 전사 — 요약하지 않은 대화 자료]\n${transcript}`);
    return completed();
  }) });
  assert.deepEqual(calls, ['https://api.openai.com/v1/audio/transcriptions', 'https://api.openai.com/v1/responses']);
  assert.equal(result.audioModel, 'gpt-transcribe');
});

test('unsupported, malformed and oversized audio stops without an API call', async () => {
  const deps = { env, request: request(() => { throw Error('must not request'); }) };
  for (const value of [{}, { ...audio, data: 'not base64' }, { ...audio, data: '' }, { ...audio, data: 'a===' }]) {
    await assert.rejects(generateChartResponse('x', value, 'gpt-astra', deps), errorCode('INVALID_AUDIO', 400));
  }
  await assert.rejects(generateChartResponse('x', { ...audio, mimeType: 'audio/aac' }, 'gpt-astra', deps), errorCode('UNSUPPORTED_AUDIO_TYPE', 400));
  const big = Buffer.alloc(25_000_001).toString('base64');
  await assert.rejects(generateChartResponse('x', { ...audio, data: big }, 'gpt-astra', deps), errorCode('AUDIO_TOO_LARGE', 413));
});

test('empty or failed transcription never proceeds to chart generation', async () => {
  for (const response of [new Response('{}'), new Response('{bad'), new Response(JSON.stringify({ text: '  ' }))]) {
    let calls = 0;
    await assert.rejects(generateChartResponse('x', audio, 'gpt-astra', { env, request: request(url => {
      calls++; assert.ok(url.endsWith('/transcriptions')); return response;
    }) }), errorCode('INVALID_AUDIO_TRANSCRIPT'));
    assert.equal(calls, 1);
  }
  await assert.rejects(generateChartResponse('x', audio, 'gpt-astra', { env, request: request(url => {
    assert.ok(url.endsWith('/transcriptions')); return new Response('secret', { status: 500 });
  }) }), errorCode('AUDIO_TRANSCRIPTION_FAILED'));
});

test('Gemini remains the default and preserves original inline audio and prompt', async () => {
  const result = await generateChartResponse('  original  ', audio, undefined, { env, geminiGenerate: async (model, prompt, recording, key, signal) => {
    assert.equal(model, 'gemini-3.1-pro-preview'); assert.equal(prompt, '  original  ');
    assert.deepEqual(recording, audio); assert.equal(key, env.GEMINI_API_KEY); assert.ok(signal instanceof AbortSignal);
    return JSON.stringify(fixture());
  } });
  assert.equal(result.engine, 'gemini'); assert.equal(result.model, 'gemini-3.1-pro-preview');
  assert.equal(result.audioModel, undefined);
});

test('retained Gemini parsing preserves the legacy acceptance rule for comparison', () => {
  for (const value of [{ chartContent: 'legacy chart only' }, { diagnosticGuide: 'legacy guide only' }]) {
    assert.deepEqual(parseChartResult(JSON.stringify(value)), value);
    assert.throws(() => parseChartResult(JSON.stringify(value), true), errorCode('INVALID_AI_RESPONSE'));
  }
  assert.throws(() => parseChartResult('{}'), errorCode('INVALID_AI_RESPONSE'));
});

test('documented Ogg and FLAC MIME types reach transcription with the correct filename', async () => {
  for (const [mimeType, extension] of [['audio/ogg', 'ogg'], ['audio/flac', 'flac'], ['audio/x-flac', 'flac']]) {
    const result = await generateChartResponse('x', { ...audio, mimeType }, 'gpt-astra', { env,
      request: request((url, init) => {
        if (url.endsWith('/transcriptions')) {
          const file = (init.body as FormData).get('file') as File;
          assert.equal(file.name, `consultation.${extension}`);
          return new Response(JSON.stringify({ text: 'synthetic transcript' }));
        }
        return completed();
      }),
    });
    assert.equal(result.audioModel, 'gpt-transcribe');
  }
});

test('Gemini retains 3-model fallback and 3 attempts per rate-limited model', async () => {
  const models: string[] = [], waits: number[] = [];
  const result = await generateChartResponse('x', undefined, 'gemini', { env,
    wait: async ms => { waits.push(ms); },
    geminiGenerate: async model => {
      models.push(model);
      if (model !== 'gemini-3.5-flash-lite') throw Object.assign(Error('synthetic'), { status: 429 });
      return JSON.stringify(fixture());
    },
  });
  assert.deepEqual(models, ['gemini-3.1-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);
  assert.deepEqual(waits, [5000, 10000, 5000, 10000]);
  assert.equal(result.model, 'gemini-3.5-flash-lite');
});

test('Gemini non-quota failures move to next model without repeated waits', async () => {
  const models: string[] = [];
  await assert.rejects(generateChartResponse('x', undefined, 'gemini', { env,
    wait: async () => { throw Error('must not wait'); }, geminiGenerate: async model => { models.push(model); throw Error('private upstream details'); },
  }), errorCode('GEMINI_REQUEST_FAILED'));
  assert.equal(models.length, 3);
});

test('caller cancellation stops before calling or falling back to another provider', async () => {
  const pre = new AbortController(); pre.abort();
  await assert.rejects(generateChartResponse('x', undefined, 'gpt-astra', { env, signal: pre.signal }), errorCode('REQUEST_CANCELLED', 499));
  const controller = new AbortController();
  await assert.rejects(generateChartResponse('x', undefined, 'gpt-astra', { env, signal: controller.signal,
    request: request(() => { controller.abort(); throw Error('AbortError'); }),
  }), errorCode('REQUEST_CANCELLED', 499));
  const gemini = new AbortController();
  let attempts = 0;
  await assert.rejects(generateChartResponse('x', undefined, 'gemini', { env, signal: gemini.signal,
    geminiGenerate: async () => { attempts++; gemini.abort(); throw Error('AbortError'); },
  }), errorCode('REQUEST_CANCELLED', 499));
  assert.equal(attempts, 1);
});
