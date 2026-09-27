import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFollowUpResponse, ASTRA_MODEL } from '../followUpEngine.ts';

const prompt = '### 합성 테스트\n기존 입력과 분석 지시문을 그대로 전달합니다.';
const env = { OPENAI_API_KEY: 'synthetic-openai-key', GEMINI_API_KEY: 'synthetic-gemini-key' };
const completed = (extra: object = {}) => ({ status: 'completed', model: ASTRA_MODEL,
  output: [{ type: 'reasoning', summary: [{ text: 'not for display' }] },
    { type: 'message', content: [{ type: 'output_text', text: '첫 분석' }, { type: 'output_text', text: '두 번째 절' }] }], ...extra });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('Astra uses the fixed model and original prompt through the server-only Responses API', async () => {
  let calls = 0;
  const result = await generateFollowUpResponse(prompt, 'gpt-astra', { env,
    geminiGenerate: async () => { throw Error('must not fall back'); },
    request: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${env.OPENAI_API_KEY}`);
      const body = JSON.parse(options!.body as string);
      assert.deepEqual(body, { model: ASTRA_MODEL, input: prompt, store: false, reasoning: { effort: 'medium' }, max_output_tokens: 16384 });
      assert.ok(options?.signal instanceof AbortSignal);
      return reply(completed());
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { text: '첫 분석\n두 번째 절', engine: 'gpt-astra', model: ASTRA_MODEL });
});

test('legacy requests default to Gemini and retain its model and prompt', async () => {
  const calls: string[] = [];
  const result = await generateFollowUpResponse(prompt, undefined, { env, geminiGenerate: async (model, input, key) => {
    calls.push(model); assert.equal(input, prompt); assert.equal(key, env.GEMINI_API_KEY); return '기존 분석';
  }});
  assert.deepEqual(calls, ['gemini-3.1-pro-preview']);
  assert.equal(result.engine, 'gemini');
});

test('Gemini retains rate-limit retry and fallback within Gemini', async () => {
  const calls: string[] = [], waits: number[] = [];
  const result = await generateFollowUpResponse(prompt, 'gemini', { env, wait: async ms => { waits.push(ms); }, geminiGenerate: async model => {
    calls.push(model);
    if (model.includes('pro')) throw Object.assign(Error('quota'), { status: 429 });
    return '대체 Gemini 분석';
  }});
  assert.deepEqual(calls, ['gemini-3.1-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3.6-flash']);
  assert.deepEqual(waits, [2000]);
  assert.equal(result.model, 'gemini-3.6-flash');
});

test('invalid input and missing keys fail before calling either paid provider', async () => {
  const request: typeof fetch = async () => { throw Error('paid call should not happen'); };
  for (const engine of ['other', 'gpt-6-sol', null, {}]) {
    await assert.rejects(generateFollowUpResponse(prompt, engine, { env, request }), { message: 'INVALID_ENGINE', status: 400 });
  }
  for (const input of ['', '   ', null, 123]) {
    await assert.rejects(generateFollowUpResponse(input, 'gpt-astra', { env, request }), { message: 'INVALID_PROMPT', status: 400 });
  }
  await assert.rejects(generateFollowUpResponse(prompt, 'gpt-astra', { env: {}, request }), { message: 'OPENAI_NOT_CONFIGURED', status: 503 });
  await assert.rejects(generateFollowUpResponse(prompt, 'gemini', { env: {}, request }), { message: 'GEMINI_NOT_CONFIGURED', status: 503 });
});

test('Astra rejects incomplete, empty and refused responses without using Gemini', async () => {
  for (const [raw, message] of [
    [completed({ status: 'incomplete' }), 'INCOMPLETE_AI_RESPONSE'],
    [completed({ output: [] }), 'EMPTY_AI_RESPONSE'],
    [completed({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), 'AI_REFUSAL'],
  ] as const) {
    await assert.rejects(generateFollowUpResponse(prompt, 'gpt-astra', { env, request: async () => reply(raw),
      geminiGenerate: async () => { throw Error('unexpected fallback'); } }), { message });
  }
});

test('Astra maps provider failures to safe errors without exposing upstream data', async () => {
  for (const [status, message] of [[401, 'OPENAI_ACCESS_DENIED'], [403, 'OPENAI_ACCESS_DENIED'], [404, 'ASTRA_UNAVAILABLE'], [429, 'QUOTA_EXCEEDED'], [500, 'OPENAI_REQUEST_FAILED']] as const) {
    let calls = 0;
    await assert.rejects(generateFollowUpResponse(prompt, 'gpt-astra', { env, request: async () => {
      calls++; return reply({ error: { message: 'private upstream data' } }, status);
    }}), { message });
    assert.equal(calls, 1);
  }
});
