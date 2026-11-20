import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';

test('authenticated search returns independent, source-linked rankings with the selected model', async t => {
  const realFetch = globalThis.fetch;
  const patient = '가상환자';
  const headers = ['성함', '증상', '처방', '효과', '효과(자세히)'];
  const rows = [headers,
    [patient, '소화불량', '평위산', '좋음', ''],
    [patient, '소화불량', '육군자탕', '나쁨', ''],
    [patient, '외부비공개증상', '평위산', '보통', '외부비공개피드백'],
    [patient, '피로', '육군자탕', '종결', ''],
    [patient, '소화불량', '안중산', '', '미전달'],
  ];
  const catalog = [['처방명'], ['평위산'], ['육군자탕'], ['안중산']];
  const calls = [];
  let invalidGuide = false;
  let listener;
  t.mock.method(express.application, 'listen', function () {
    listener = createServer(this).listen(0, '127.0.0.1');
    return listener;
  });
  const activeEnv = { NODE_ENV: 'production', OPENAI_API_KEY: 'synthetic', GEMINI_API_KEY: 'synthetic' };
  const saved = Object.fromEntries(Object.keys(activeEnv).map(key => [key, process.env[key]]));
  Object.assign(process.env, activeEnv);
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (listener) await new Promise(resolve => listener.close(resolve));
  });
  t.mock.method(globalThis, 'fetch', async (resource, init = {}) => {
    const url = decodeURIComponent(String(resource instanceof Request ? resource.url : resource));
    if (url.includes('identitytoolkit.googleapis.com')) return Response.json({
      users: [{localId: 'synthetic-user', email: 'test@example.invalid', emailVerified: true}],
    });
    if (url.includes('firestore.googleapis.com')) return Response.json({ fields: {role: {stringValue: 'user'}} });
    if (url.includes('sheets.googleapis.com')) {
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-sheet-token');
      assert.equal(init.method || 'GET', 'GET');
      if (url.includes("'한약환자'!A1:W")) return Response.json({values: rows});
      assert.ok(url.includes("'약재'!A1:D"));
      return Response.json({values: catalog});
    }
    const openai = url.includes('api.openai.com');
    assert.ok(openai || url.includes('gemini-4-argon'));
    const body = JSON.parse(init.body ?? await resource.text());
    const model = openai ? body.model : 'gemini-4-argon';
    if (openai) assert.equal(body.store, false);
    const prompt = openai ? body.input : body.contents[0].parts[0].text;
    assert.doesNotMatch(prompt, /가상환자|synthetic-sheet-token|test@example|외부비공개/);
    const properties = (openai ? body.text.format.schema : body.generationConfig.responseJsonSchema).properties;
    let output;
    if (properties.options) {
      const evidence = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"targets"')));
      const entry = name => evidence.entries.find(item => item.name === name);
      assert.equal(entry('육군자탕').used, true);
      assert.equal(entry('안중산').used, false);
      assert.ok(properties.options.items.required.includes('conditionPhrases'));
      calls.push([model, 'guide']);
      output = invalidGuide ? 'invalid' : JSON.stringify({options: [{
        ids: [entry('안중산').id], reason: '자료에 기재된 증상과의 일치', indications: '기재 양상을 확인',
        conditionPhrases: ['복부 긴장이 약하면서 위통·복통'], combinationRationale: '',
      }]});
    } else {
      assert.ok(properties.recommendations.items.required.includes('rankBasis'));
      calls.push([model, 'clinic']);
      output = JSON.stringify({shortlistNote: '긍정적으로 평가된 다른 후보가 없습니다.', recommendations: [{
        baseId: 1, rankBasis: 'solo', reason: '시트 단독 사용 결과', guidance: '', groupIds: [1], limitation: '한 건', additions: [],
      }]});
    }
    return Response.json(openai
      ? {model, status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: output}]}]}
      : {modelVersion: model, candidates: [{content: {role: 'model', parts: [{text: output}]}, finishReason: 'STOP'}]});
  });
  await import('../server.ts');
  if (!listener.listening) await once(listener, 'listening');
  const endpoint = 'http://127.0.0.1:' + listener.address().port + '/api/prescription-search';
  const search = (model, query, auth = true, view = 'component-synthesis-with-guide') => realFetch(endpoint, {
    method: 'POST', headers: {'Content-Type': 'application/json', ...(auth && {Authorization: 'Bearer synthetic-app-token-long-enough'})},
    body: JSON.stringify({model, query, accessToken: 'synthetic-sheet-token', view}),
  });
  assert.equal((await search('gpt-6.2-astra', '소화불량', false)).status, 401);
  for (const model of ['gpt-6.2-astra', 'gemini-4-argon']) {
    calls.length = 0;
    const response = await search(model, '소화불량');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(calls.sort(), [[model, 'clinic'], [model, 'guide']]);
    const [clinicOption] = result.recommendations;
    assert.equal(clinicOption.base, '평위산');
    assert.match(clinicOption.headline, /단독/);
    assert.equal(clinicOption.study.solo.good, 1);
    assert.equal(clinicOption.study.targetImproved, 0);
    assert.equal(clinicOption.study.absent.bad, 1);
    assert.equal(clinicOption.study.otherTargets.included.neutral, 1);
    assert.ok(result.shortlistNote);
    assert.equal(result.guideSuggestions.status, 'ok');
    const [option] = result.guideSuggestions.recommendations;
    assert.equal(option.formula, '안중산');
    assert.equal(option.rank, 1);
    assert.equal(option.conditionSummary, '복부 긴장이 약하면서 위통·복통');
    assert.match(option.references[0].url, /^https:\/\//);
    assert.ok(option.references[0].excerpt.length);
    assert.doesNotMatch(JSON.stringify(result), /가상환자|synthetic-sheet-token|외부비공개/);
  }
  const noClinic = await (await search('gpt-6.2-astra', '위통')).json();
  assert.equal(noClinic.status, 'insufficient');
  assert.equal(noClinic.guideSuggestions.status, 'ok');
  invalidGuide = true;
  const partial = await (await search('gpt-6.2-astra', '소화불량')).json();
  assert.equal(partial.status, 'synthesized');
  assert.equal(partial.guideSuggestions.status, 'unavailable');
  calls.length = 0;
  const legacy = await (await search('gpt-6.2-astra', '소화불량', true, '')).json();
  assert.match(legacy.text, /평위산/);
  assert.deepEqual(legacy.rankings, []);
  assert.equal(legacy.guideSuggestions, undefined);
});
