const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function client(request) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/aiService.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name.includes('authFetch')) return { authFetch: request };
    if (name.includes('prompts')) return { generateChartPrompt: briefing => `unchanged:${briefing.mainSymptom}` };
    return {};
  }, module, module.exports);
  return module.exports;
}

test('chart client sends the chosen engine, original prompt and audio together', async () => {
  for (const engine of ['gemini', 'gpt-astra']) {
    const audio = { mimeType: 'audio/wav', data: 'c3ludGhldGlj' };
    const result = { chartContent: 'chart', diagnosticGuide: 'guide', treatmentRecommendation: 'treatment', herbsRecipe: [], engine, model: 'actual-model' };
    const api = client(async (url, options) => {
      assert.equal(url, '/api/generate-chart');
      assert.deepEqual(JSON.parse(options.body), { prompt: 'unchanged:synthetic symptom', audioData: audio, engine });
      return Response.json(result);
    });
    assert.deepEqual(await api.generateAIChart({ mainSymptom: 'synthetic symptom' }, audio, engine), result);
  }
});

test('chart client preserves recipe calculation with the OpenAI structured result', async () => {
  const recipes = [{ '합방_처방': ['테스트처방'], '가감_목록': [] }];
  const calls = [];
  const api = client(async (url, options) => {
    calls.push(url);
    if (url === '/api/generate-chart') return Response.json({
      chartContent: 'chart', diagnosticGuide: 'guide', treatmentRecommendation: 'treatment',
      herbsRecipe: recipes, engine: 'gpt-astra', model: 'gpt-6-astra',
    });
    assert.equal(url, '/api/proxy-webhook');
    assert.deepEqual(JSON.parse(options.body), recipes);
    return Response.json([{ final_recipe: { '테스트약재': 2 } }]);
  });
  const result = await api.generateAIChart({ mainSymptom: 'synthetic symptom' }, undefined, 'gpt-astra');
  assert.deepEqual(calls, ['/api/generate-chart', '/api/proxy-webhook']);
  assert.match(result.herbAmountsHtml, /테스트약재/);
  assert.match(result.herbAmountsHtml, /30일/);
});

test('chart client rejects malformed/mismatched output before recipe calls and preserves errors', async () => {
  const api = client(async () => Response.json({
    chartContent: 'chart', diagnosticGuide: 'guide', treatmentRecommendation: 'treatment',
    engine: 'gemini', model: 'other-model', herbsRecipe: [{}],
  }));
  await assert.rejects(api.generateAIChart({}, undefined, 'gpt-astra'), /INVALID_AI_RESPONSE/);
  const missing = client(async () => Response.json({ error: 'OPENAI_NOT_CONFIGURED' }, { status: 503 }));
  await assert.rejects(missing.generateAIChart({}, undefined, 'gpt-astra'), /OPENAI_NOT_CONFIGURED/);
});


test('retained Gemini output keeps legacy acceptance when optional-looking fields are omitted', async () => {
  const result = { chartContent: 'legacy chart', engine: 'gemini', model: 'gemini-3.1-pro-preview' };
  const api = client(async () => Response.json(result));
  assert.deepEqual(await api.generateAIChart({}, undefined, 'gemini'), result);
});
