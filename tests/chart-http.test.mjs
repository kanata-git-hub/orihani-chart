import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const chart = {
  chartContent: '- c/c : 합성 시험 증상\n- Assessment : 합성 시험 진단',
  diagnosticGuide: '🔍 [감별 진단 포인트]\n- 합성 시험 소견',
  matchProbability: '80%',
  matchReason: '합성 시험 근거',
  assessmentDisease: '합성 시험 진단',
  treatmentRecommendation: '💊 [최적 치료법 및 타겟]\n- 합성 시험 처방',
  recommendedTreatmentType: '합성시험처방',
  consultationFeedback: '음성 녹음이 제공되지 않아 가이드를 생략합니다.',
  herbsRecipe: [{ 합방_처방: ['합성시험처방'], 가감_목록: [
    { 약재명: '합성추가약재', 동작: '가', 용량_g: 2, 남길_비율: null },
    { 약재명: '합성제외약재', 동작: '감', 용량_g: null, 남길_비율: 0 },
  ] }],
};
const originalPrompt = '  합성 시험: 원문과 줄바꿈을 보존합니다.\n세부 지시 그대로.  ';
const transcript = '환자: 통증은 6점이고 저리지는 않습니다. 원장: 증상 경과를 확인하겠습니다.';
const syntheticAudio = Buffer.from('RIFF0000WAVEfmt synthetic audio fixture only').toString('base64');
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token-long-enough' };

// Start the actual Express app in a child process; every upstream call is mocked.
// Synthetic secrets are deliberately recognizable so accidental disclosure is caught.
async function startServer({ withKey = true, transcriptionFailure = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chart-initial-http-'));
  const preload = join(dir, 'mock.mjs');
  await writeFile(preload, `
    import assert from 'node:assert/strict';
    const chart = ${JSON.stringify(chart)};
    const originalPrompt = ${JSON.stringify(originalPrompt)};
    const transcript = ${JSON.stringify(transcript)};
    const reply = (body, status=200) => new Response(JSON.stringify(body), {status});
    const completed = text => reply({status:'completed',model:'gpt-6-astra-test-snapshot',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]});
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url instanceof Request ? url.url : url);
      if (target.includes('identitytoolkit.googleapis.com')) {
        return reply({users:[{localId:'synthetic-user',email:'kanata840@gmail.com',emailVerified:true}]});
      }
      if (target === 'https://api.openai.com/v1/audio/transcriptions') {
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.ok(options.body instanceof FormData);
        assert.equal(options.body.get('model'), 'gpt-transcribe');
        assert.ok(options.body.get('file') instanceof Blob);
        assert.ok(options.body.get('file').size > 0);
        assert.ok(options.signal instanceof AbortSignal);
        if (${transcriptionFailure}) return reply({error:{message:'upstream-secret-marker'}},500);
        return reply({text:transcript,languages:[{code:'ko'}]});
      }
      if (target === 'https://api.openai.com/v1/responses') {
        assert.equal(${transcriptionFailure}, false, 'transcription failure must stop before chart generation');
        const input = JSON.parse(options.body);
        assert.equal(options.method,'POST');
        assert.equal(options.redirect,'error');
        assert.equal(input.model,'gpt-6-astra');
        assert.equal(input.store,false);
        assert.equal(input.reasoning.effort,'medium');
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(input.text.format.type,'json_schema');
        assert.equal(input.text.format.strict,true);
        assert.equal(input.text.format.schema.additionalProperties,false);
        assert.deepEqual([...input.text.format.schema.required].sort(),Object.keys(input.text.format.schema.properties).sort());
        const content = typeof input.input === 'string' ? [input.input] : input.input.flatMap(item => item.content.map(part => part.text));
        const prompt = content[0];
        if (prompt === 'audio-synthetic') {
          assert.ok(content.some(part => part.includes(transcript)), 'exact transcript must reach Astra');
          assert.equal(content[0],'audio-synthetic');
          return completed(JSON.stringify({...chart,consultationFeedback:'🌟 [긍정적인 부분]\\n- 합성 전사 대화 확인'}));
        }
        if (prompt === 'incomplete') return reply({status:'incomplete',output:[]});
        if (prompt === 'rate-limit') return reply({error:{message:'upstream-secret-marker'}},429);
        if (prompt === 'invalid-json') return completed('{ malformed upstream-secret-marker');
        if (prompt === 'empty-fields') return completed(JSON.stringify({...chart,chartContent:'',diagnosticGuide:''}));
        if (prompt === 'access-denied') return reply({error:{message:'upstream-secret-marker'}},401);
        if (prompt === 'refusal') return reply({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'upstream-secret-marker'}]}]});
        assert.equal(prompt, originalPrompt);
        return completed(JSON.stringify(chart));
      }
      if (target.startsWith('https://generativelanguage.googleapis.com/')) {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
        assert.ok(body, 'Gemini request body must be inspectable in the synthetic boundary');
        const parts = body.contents[0].parts;
        assert.equal(parts.find(part => typeof part.text === 'string').text, originalPrompt);
        if (parts.some(part => part.inlineData)) {
          assert.deepEqual(parts.find(part => part.inlineData).inlineData,{mimeType:'audio/wav',data:${JSON.stringify(syntheticAudio)}});
        }
        const geminiChart = {...chart,herbsRecipe:[]};
        return reply({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(geminiChart)}]},finishReason:'STOP'}]});
      }
      throw Error('Unexpected synthetic upstream request');
    };
  `);
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['--experimental-strip-types', '--import', preload, 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), GEMINI_API_KEY: 'synthetic-gemini-secret', OPENAI_API_KEY: withKey ? 'synthetic-openai-secret' : '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stderr.on('data', value => { logs += value; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Server startup timeout: '+logs)), 10000);
      child.once('exit', code => { clearTimeout(timeout); reject(Error('Server exited: '+code+' '+logs)); });
      child.stdout.on('data', value => {
        logs += value;
        if (String(value).includes('Production Server running')) { clearTimeout(timeout); resolve(); }
      });
    });
  } catch (error) {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    url: `http://127.0.0.1:${port}/api/generate-chart`,
    logs: () => logs,
    close: async () => {
      if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const request = (server, body) => fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body) });

test('initial chart HTTP boundary preserves auth, prompt, provider metadata and recipe output', async () => {
  const server = await startServer();
  try {
    const anonymous = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: originalPrompt, engine: 'gpt-astra' }) });
    assert.equal(anonymous.status, 401);
    const marker = 'private-chart-marker';
    const malformed = await fetch(server.url, { method: 'POST', headers, body: marker });
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(await malformed.text(), /private-chart-marker/);
    for (const engine of [undefined, 'gemini', 'gpt-astra']) {
      const response = await request(server, { prompt: originalPrompt, engine });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.chartContent, chart.chartContent);
      assert.equal(result.treatmentRecommendation, chart.treatmentRecommendation);
      assert.equal(result.engine, engine || 'gemini');
      assert.equal(result.model, engine === 'gpt-astra' ? 'gpt-6-astra-test-snapshot' : 'gemini-3.1-pro-preview');
      if (engine === 'gpt-astra') {
        assert.deepEqual(result.herbsRecipe, [{ 합방_처방: ['합성시험처방'], 가감_목록: [
          { 약재명: '합성추가약재', 동작: '가', 용량_g: 2 },
          { 약재명: '합성제외약재', 동작: '감', 남길_비율: 0 },
        ] }]);
      }
    }
    assert.doesNotMatch(server.logs(), /private-chart-marker|synthetic-openai-secret|synthetic-gemini-secret/);
  } finally { await server.close(); }
});

test('initial chart HTTP boundary reports provider failures without leaking or falling back', async () => {
  const server = await startServer();
  try {
    const cases = [
      [{ prompt: originalPrompt, engine: 'unknown' }, 400, 'INVALID_ENGINE'],
      [{ prompt: '', engine: 'gpt-astra' }, 400, 'INVALID_PROMPT'],
      [{ prompt: 'incomplete', engine: 'gpt-astra' }, 502, 'INCOMPLETE_AI_RESPONSE'],
      [{ prompt: 'rate-limit', engine: 'gpt-astra' }, 429, 'QUOTA_EXCEEDED'],
      [{ prompt: 'invalid-json', engine: 'gpt-astra' }, 502, 'INVALID_AI_RESPONSE'],
      [{ prompt: 'empty-fields', engine: 'gpt-astra' }, 502, 'INVALID_AI_RESPONSE'],
      [{ prompt: 'access-denied', engine: 'gpt-astra' }, 503, 'OPENAI_ACCESS_DENIED'],
      [{ prompt: 'refusal', engine: 'gpt-astra' }, 502, 'AI_REFUSAL'],
      [{ prompt: originalPrompt, engine: 'gpt-astra', audioData: { mimeType: 'image/png', data: syntheticAudio } }, 400, 'UNSUPPORTED_AUDIO_TYPE'],
      [{ prompt: originalPrompt, engine: 'gpt-astra', audioData: { mimeType: 'audio/wav', data: 'not-base64!' } }, 400, 'INVALID_AUDIO'],
    ];
    for (const [body, status, code] of cases) {
      const response = await request(server, body);
      const raw = await response.text();
      assert.equal(response.status, status, raw);
      assert.equal(JSON.parse(raw).error, code);
      assert.doesNotMatch(raw, /upstream-secret-marker|synthetic-openai-secret/);
    }
    assert.doesNotMatch(server.logs(), /upstream-secret-marker|synthetic-openai-secret/);
  } finally { await server.close(); }
});

test('missing OpenAI key leaves Gemini available and does not silently use it for Astra', async () => {
  const server = await startServer({ withKey: false });
  try {
    const astra = await request(server, { prompt: originalPrompt, engine: 'gpt-astra' });
    assert.equal(astra.status, 503);
    assert.equal((await astra.json()).error, 'OPENAI_NOT_CONFIGURED');
    const gemini = await request(server, { prompt: originalPrompt, engine: 'gemini' });
    assert.equal(gemini.status, 200, await gemini.clone().text());
    assert.equal((await gemini.json()).engine, 'gemini');
  } finally { await server.close(); }
});

test('audio uses transcription before Astra and preserves original inline audio for Gemini', async () => {
  const server = await startServer();
  try {
    const astra = await request(server, { prompt: 'audio-synthetic', engine: 'gpt-astra', audioData: { mimeType: 'audio/wav', data: syntheticAudio } });
    assert.equal(astra.status, 200, await astra.clone().text());
    const result = await astra.json();
    assert.equal(result.engine, 'gpt-astra');
    assert.equal(result.audioModel, 'gpt-transcribe');
    assert.match(result.consultationFeedback, /합성 전사 대화 확인/);
    const gemini = await request(server, { prompt: originalPrompt, engine: 'gemini', audioData: { mimeType: 'audio/wav', data: syntheticAudio } });
    assert.equal(gemini.status, 200, await gemini.clone().text());
    assert.equal((await gemini.json()).engine, 'gemini');
    assert.doesNotMatch(server.logs(), /통증은 6점|synthetic-openai-secret/);
  } finally { await server.close(); }
});

test('failed audio transcription never becomes a successful chart without audio', async () => {
  const server = await startServer({ transcriptionFailure: true });
  try {
    const response = await request(server, { prompt: 'audio-synthetic', engine: 'gpt-astra', audioData: { mimeType: 'audio/wav', data: syntheticAudio } });
    const raw = await response.text();
    assert.equal(response.status, 502, raw);
    assert.equal(JSON.parse(raw).error, 'AUDIO_TRANSCRIPTION_FAILED');
    assert.doesNotMatch(raw, /upstream-secret-marker|synthetic-openai-secret/);
    assert.doesNotMatch(server.logs(), /upstream-secret-marker|synthetic-openai-secret/);
  } finally { await server.close(); }
});
