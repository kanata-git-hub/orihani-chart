import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSeparateBaselineOutput, compareCases, prepareCases, promptHash, readComparisonBaseline, readComparisonCheckpoint, renderComparisonHtml, writeComparison } from '../scripts/compare-ai.ts';
import type { ComparisonCase } from '../scripts/comparisonCases.ts';
import { OPENAI_CLINICAL_INSTRUCTIONS } from '../openaiClinicalInstructions.ts';

const sample: ComparisonCase = { id: 'synthetic', kind: 'chart', title: '합성 <script>bad()</script>', synthetic: true,
  prompt: '동일한 원문\n  공백 보존 <b>테스트</b>', reviewPoints: ['확인 <img src=x onerror=bad()>'] };

test('comparison calls providers serially with the same unchanged prompt and audio', async () => {
  const order: string[] = [], seen: ComparisonCase[] = [];
  const item = { ...sample, audioData: { mimeType: 'audio/wav', data: Buffer.from('synthetic').toString('base64') } };
  const result = await compareCases([item], {
    gemini: async value => { order.push('gemini-start'); seen.push(value); await Promise.resolve(); order.push('gemini-end'); return { engine: 'gemini', model: 'gemini-actual', chartContent: '기존 결과' }; },
    'gpt-astra': async value => { order.push('astra'); seen.push(value); return { engine: 'gpt-astra', model: 'astra-actual', audioModel: 'transcription-actual', chartContent: '새 결과' }; },
  });
  assert.deepEqual(order, ['gemini-start', 'gemini-end', 'astra']);
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[0].prompt, sample.prompt);
  assert.deepEqual(seen[0].audioData, item.audioData);
  assert.equal(result[0].promptSha256, promptHash(sample.prompt));
  assert.equal(result[0].openaiInstructions, OPENAI_CLINICAL_INSTRUCTIONS);
  assert.equal(result[0].openaiInstructionsSha256, promptHash(OPENAI_CLINICAL_INSTRUCTIONS));
  assert.equal(result[0].effectivePromptsIdentical, false);
  assert.equal(result[0].runs[0].actualModel, 'gemini-actual');
  assert.equal(result[0].runs[1].audioModel, 'transcription-actual');
  assert.equal(result[0].audio?.bytes, 9);
});

test('one provider failure is masked and does not prevent the other result', async () => {
  const result = await compareCases([sample], {
    gemini: async () => { throw Object.assign(Error('secret sk-not-for-report request body'), { status: 429 }); },
    'gpt-astra': async () => ({ engine: 'gpt-astra', model: 'astra-actual', text: '합성 결과' }),
  });
  assert.equal(result[0].runs[0].status, 'failed');
  assert.deepEqual(result[0].runs[0].error, { code: 'COMPARISON_REQUEST_FAILED', status: 429 });
  assert.equal(result[0].runs[1].status, 'completed');
  assert.doesNotMatch(JSON.stringify(result), /sk-not-for-report|request body/);
});

test('a mismatched provider or absent actual model is not a successful comparison', async () => {
  const result = await compareCases([sample], {
    gemini: async () => ({ engine: 'gpt-astra', model: 'wrong-provider' }),
    'gpt-astra': async () => ({ engine: 'gpt-astra', text: 'no metadata' }),
  });
  assert.ok(result[0].runs.every(run => run.status === 'failed' && run.error?.code === 'INVALID_AI_RESPONSE'));
});

test('HTML escapes all prompt, title, review and model output content and leaves quality pending', async () => {
  const result = await compareCases([sample], {
    gemini: async () => ({ engine: 'gemini', model: '<script>model()</script>', text: '</pre><img src=x onerror=bad()>' }),
    'gpt-astra': async () => ({ engine: 'gpt-astra', model: 'astra', text: '합성 결과' }),
  });
  const html = renderComparisonHtml(result, '2026-01-01');
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /수동 검토 대기/);
  assert.match(html, /음성 비교 미실시/);
  assert.match(html, /의학적 동등성·우월성의 증명이 아닙니다/);
});

test('written report contains full application result but no automatic clinical pass claim', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ori-comparison-'));
  try {
    const result = await compareCases([sample], {
      gemini: async () => ({ engine: 'gemini', model: 'g', chartContent: '원문 결과' }),
      'gpt-astra': async () => ({ engine: 'gpt-astra', model: 'a', chartContent: '새 결과' }),
    });
    const files = await writeComparison(result, out);
    const report = JSON.parse(await readFile(files.jsonPath, 'utf8'));
    assert.equal(report.reviewStatus, 'pending_manual_review');
    assert.equal(report.clinicalEquivalence, 'not_established');
    assert.equal(report.cases[0].runs[0].result.chartContent, '원문 결과');
    assert.equal(report.audioComparisonIncluded, false);
    assert.equal(report.effectivePromptsIdentical, false);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('fixtures use existing prompt factories and are synthetic with seven text cases', async () => {
  const cases = await prepareCases();
  assert.equal(cases.length, 7);
  assert.equal(new Set(cases.map(item => item.id)).size, 7);
  assert.ok(cases.every(item => item.synthetic && item.prompt.includes('합성 사례') && !item.audioData));
  assert.equal(cases.filter(item => item.kind === 'chart').length, 3);
  assert.equal(cases.filter(item => item.kind === 'followup').length, 4);
  const { tsImport } = await import('tsx/esm/api');
  const { generateChartPrompt } = await tsImport('../src/services/prompts.ts', import.meta.url);
  assert.ok(cases[0].prompt.startsWith(generateChartPrompt({}).slice(0, 100)));
});

test('CLI dry run works without credentials and live mode refuses missing credentials before requests', () => {
  const env = { ...process.env, OPENAI_API_KEY: '', GEMINI_API_KEY: '' };
  const cli = fileURLToPath(new URL('../scripts/compare-ai.ts', import.meta.url));
  const dry = spawnSync(process.execPath, ['--experimental-strip-types', cli, '--dry-run', '--case', 'followup-plateau'], { env, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  const manifest = JSON.parse(dry.stdout);
  assert.equal(manifest.paidCalls, 0);
  assert.equal(manifest.cases.length, 1);
  assert.equal(manifest.cases[0].id, 'followup-plateau');
  assert.equal(manifest.effectivePromptsIdentical, false);
  assert.equal(manifest.cases[0].openaiInstructionsSha256, promptHash(OPENAI_CLINICAL_INSTRUCTIONS));
  const live = spawnSync(process.execPath, ['--experimental-strip-types', cli, '--case', 'followup-plateau'], { env, encoding: 'utf8' });
  assert.equal(live.status, 2);
  assert.match(live.stderr, /No request was sent/);
  assert.doesNotMatch(live.stderr, /\n\s+at /);
});

const fakeClients = {
  gemini: async () => ({ engine: 'gemini', model: 'gemini-actual', chartContent: '기존 결과' }),
  'gpt-astra': async () => ({ engine: 'gpt-astra', model: 'astra-actual', chartContent: '새 결과' }),
};

test('every settled request is saved before progress and an interrupted run resumes without repeating completed calls', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ori-resume-'));
  const events: string[] = [];
  try {
    let checkpoints = 0;
    await assert.rejects(compareCases([sample], fakeClients, {
      onProgress: event => { events.push(`${event.engine}:${event.status}`); },
      onCheckpoint: async entries => {
        await writeComparison(entries, out);
        checkpoints++;
        if (checkpoints === 1) throw Error('simulated interruption after persisted response');
      },
    }), /simulated interruption/);
    assert.deepEqual(events, ['gemini:started']);
    const resume = await readComparisonCheckpoint(out);
    assert.equal(resume[0].runs.length, 1);
    assert.equal(resume[0].runs[0].status, 'completed');
    let geminiCalls = 0, astraCalls = 0;
    const result = await compareCases([sample], {
      gemini: async () => { geminiCalls++; return fakeClients.gemini(); },
      'gpt-astra': async () => { astraCalls++; return fakeClients['gpt-astra'](); },
    }, { resume, onCheckpoint: async entries => { await writeComparison(entries, out); events.push('saved'); },
      onProgress: event => { events.push(`${event.engine}:${event.status}`); } });
    assert.equal(geminiCalls, 0);
    assert.equal(astraCalls, 1);
    assert.deepEqual(events.slice(1), ['saved', 'gemini:reused', 'gpt-astra:started', 'saved', 'gpt-astra:completed']);
    assert.equal(result[0].runs.length, 2);
    assert.deepEqual((await readdir(out)).sort(), ['comparison.html', 'comparison.json']);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('failed requests retry while independently completed later results are retained in all checkpoints', async () => {
  const initial = await compareCases([sample], { ...fakeClients, gemini: async () => { throw Error('QUOTA_EXCEEDED'); } });
  let calls = 0;
  const snapshots: any[] = [];
  const result = await compareCases([sample], {
    gemini: async () => { calls++; return fakeClients.gemini(); },
    'gpt-astra': async () => { throw Error('completed Astra must not rerun'); },
  }, { resume: initial, onCheckpoint: entries => { snapshots.push(entries); } });
  assert.equal(calls, 1);
  assert.ok(result[0].runs.every(run => run.status === 'completed'));
  assert.ok(snapshots.every(entries => entries[0].runs[1].status === 'completed'));
});

test('resume rejects changed input identity, non-synthetic results, reversed engines and mismatched model metadata', async () => {
  const initial = await compareCases([sample], fakeClients);
  const corruptions = [
    (entry: any) => { entry.id = 'different'; },
    (entry: any) => { entry.kind = 'followup'; },
    (entry: any) => { entry.synthetic = false; },
    (entry: any) => { entry.prompt += ' changed'; },
    (entry: any) => { entry.promptSha256 = 'incorrect'; },
    (entry: any) => { entry.openaiInstructions += ' stale'; entry.openaiInstructionsSha256 = promptHash(entry.openaiInstructions); },
    (entry: any) => { entry.openaiInstructions = ''; entry.openaiInstructionsSha256 = promptHash(''); entry.effectivePromptsIdentical = true; },
    (entry: any) => { delete entry.openaiInstructions; delete entry.openaiInstructionsSha256; },
    (entry: any) => { entry.openaiInstructionsSha256 = 'incorrect'; },
    (entry: any) => { entry.effectivePromptsIdentical = true; },
    (entry: any) => { entry.audio = { mimeType: 'audio/wav', bytes: 1, sha256: 'x' }; },
    (entry: any) => { entry.runs.reverse(); },
  ];
  for (const corrupt of corruptions) {
    const resume = structuredClone(initial); corrupt(resume[0]);
    let calls = 0;
    await assert.rejects(compareCases([sample], {
      gemini: async () => { calls++; return fakeClients.gemini(); },
      'gpt-astra': async () => { calls++; return fakeClients['gpt-astra'](); },
    }, { resume }), /Invalid comparison checkpoint/);
    assert.equal(calls, 0);
  }
  const modelMismatch = structuredClone(initial);
  modelMismatch[0].runs[0].actualModel = 'wrong-model';
  let calls = 0;
  await assert.rejects(compareCases([sample], {
    gemini: async () => { calls++; return fakeClients.gemini(); },
    'gpt-astra': async () => { throw Error('valid result should be reused'); },
  }, { resume: modelMismatch }), /Invalid comparison checkpoint/);
  assert.equal(calls, 0);
});

test('audio resume requires the same audio bytes, MIME and size', async () => {
  const item = { ...sample, audioData: { mimeType: 'audio/wav', data: Buffer.from('audio A').toString('base64') } };
  const initial = await compareCases([item], fakeClients);
  let calls = 0;
  await assert.rejects(compareCases([{ ...item, audioData: { ...item.audioData, data: Buffer.from('audio B').toString('base64') } }], {
    gemini: async () => { calls++; return fakeClients.gemini(); },
    'gpt-astra': async () => { calls++; return fakeClients['gpt-astra'](); },
  }, { resume: initial }), /Invalid comparison checkpoint/);
  assert.equal(calls, 0);
});

test('subset, duplicate and changed later checkpoint cases stop before paid work or replacing the full report', async () => {
  const other = { ...sample, id: 'second', prompt: '두 번째 합성 사례' };
  const initial = await compareCases([sample, other], fakeClients);
  let calls = 0, writes = 0;
  const clients = {
    gemini: async () => { calls++; return fakeClients.gemini(); },
    'gpt-astra': async () => { calls++; return fakeClients['gpt-astra'](); },
  };
  const onCheckpoint = () => { writes++; };
  await assert.rejects(compareCases([sample], clients, { resume: initial, onCheckpoint }), /Invalid comparison checkpoint/);
  await assert.rejects(compareCases([sample, other], clients, { resume: [initial[0], initial[0]], onCheckpoint }), /Invalid comparison checkpoint/);
  const changed = structuredClone(initial); changed[1].promptSha256 = 'wrong';
  await assert.rejects(compareCases([sample, other], clients, { resume: changed, onCheckpoint }), /Invalid comparison checkpoint/);
  assert.equal(calls, 0);
  assert.equal(writes, 0);
  assert.equal(initial.length, 2);
  assert.ok(initial.every(entry => entry.runs.length === 2));
});

test('a partial checkpoint may contain empty later cases while keeping the complete selected case set', async () => {
  const other = { ...sample, id: 'second', prompt: '두 번째 합성 사례' };
  const initial = await compareCases([sample, other], fakeClients);
  initial[0].runs = initial[0].runs.slice(0, 1);
  initial[1].runs = [];
  const called: string[] = [];
  const result = await compareCases([sample, other], {
    gemini: async item => { called.push(`${item.id}:gemini`); return fakeClients.gemini(); },
    'gpt-astra': async item => { called.push(`${item.id}:astra`); return fakeClients['gpt-astra'](); },
  }, { resume: initial });
  assert.deepEqual(called, ['synthetic:astra', 'second:gemini', 'second:astra']);
  assert.ok(result.every(entry => entry.runs.length === 2 && entry.runs.every(run => run.status === 'completed')));
});

test('checkpoint reader rejects corrupt envelopes and evaluator versions before any model request', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ori-version-'));
  try {
    assert.deepEqual(await readComparisonCheckpoint(out), []);
    await writeFile(join(out, 'comparison.json'), 'invalid json');
    await assert.rejects(readComparisonCheckpoint(out), /Invalid comparison checkpoint/);
    await writeFile(join(out, 'comparison.json'), JSON.stringify({ synthetic: false, reviewStatus: 'pending_manual_review', cases: [] }));
    await assert.rejects(readComparisonCheckpoint(out), /Invalid comparison checkpoint/);
    await writeFile(join(out, 'comparison.json'), JSON.stringify({ synthetic: true, reviewStatus: 'pending_manual_review', evaluatorCommit: 'a'.repeat(40), cases: [] }));
    await assert.rejects(readComparisonCheckpoint(out, 'b'.repeat(40)), /version differs/);
    assert.deepEqual(await readComparisonCheckpoint(out, 'a'.repeat(40)), []);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('progress contains only the expected event fields and checkpoint failure stops subsequent paid calls', async () => {
  const events: any[] = [];
  let calls = 0;
  await assert.rejects(compareCases([sample], {
    gemini: async () => { calls++; throw Error('private secret'); },
    'gpt-astra': async () => { calls++; return fakeClients['gpt-astra'](); },
  }, { onProgress: event => { events.push(event); }, onCheckpoint: () => { throw Error('disk write failed'); } }), /disk write failed/);
  assert.equal(calls, 1);
  assert.deepEqual(events, [{ index: 1, total: 2, caseId: 'synthetic', engine: 'gemini', status: 'started' }]);
  assert.doesNotMatch(JSON.stringify(events), /private|secret|disk/);
});

const baselineOutput = (item: ComparisonCase, engine: 'gemini' | 'gpt-astra') => ({
  ...(item.kind === 'chart' ? { chartContent: `${engine} original chart`, diagnosticGuide: 'guide', matchProbability: '85%',
    matchReason: 'reason', assessmentDisease: 'diagnosis', treatmentRecommendation: 'recommendation', recommendedTreatmentType: 'type',
    consultationFeedback: 'no audio', herbsRecipe: [{ 합방_처방: ['synthetic formula'] }] } : { text: `${engine} original followup` }),
  engine, model: engine === 'gemini' ? 'gemini-3.1-pro-preview' : 'gpt-6-astra',
  ...(engine === 'gpt-astra' && item.audioData ? { audioModel: 'gpt-transcribe' } : {}),
});

async function makeBaseline(cases: ComparisonCase[]) {
  const compared = await compareCases(cases, {
    gemini: async item => baselineOutput(item, 'gemini'),
    'gpt-astra': async item => baselineOutput(item, 'gpt-astra'),
  });
  return { generatedAt: '2026-11-11T04:18:31.151Z', evaluatorCommit: 'bcd998055187bbfd4dc223e14dbaa10b09ebf510',
    synthetic: true, reviewStatus: 'pending_manual_review', clinicalEquivalence: 'not_established',
    audioComparisonIncluded: cases.some(item => item.audioData), cases: compared.map(entry => {
      const old: any = structuredClone(entry);
      old.openaiInstructions = ''; old.openaiInstructionsSha256 = promptHash(''); old.effectivePromptsIdentical = true;
      return old;
    }) };
}

test('baseline reuse makes exactly seven new Astra calls and preserves Gemini provenance and unchanged fixture prompts', async () => {
  const cases = await prepareCases(), baseline = await makeBaseline(cases);
  const events: any[] = [], calls: string[] = [];
  const compared = await compareCases(cases, {
    gemini: async () => { calls.push('gemini'); throw Error('must not call Gemini'); },
    'gpt-astra': async item => { calls.push(item.id); return { ...baselineOutput(item, 'gpt-astra'), candidate: true }; },
  }, { baseline, onProgress: event => { events.push(event); } });
  assert.deepEqual(calls, cases.map(item => item.id));
  assert.equal(events.filter(event => event.engine === 'gemini' && event.status === 'reused').length, 7);
  for (const [index, entry] of compared.entries()) {
    assert.equal(entry.prompt, cases[index].prompt);
    assert.deepEqual(entry.runs[0].result, baseline.cases[index].runs[0].result);
    assert.equal((entry.runs[1].result as any).candidate, true);
    assert.equal(entry.runs[0].provenance?.generatedAt, baseline.generatedAt);
    assert.equal(entry.runs[0].provenance?.evaluatorCommit, baseline.evaluatorCommit);
    assert.equal(entry.runs[0].provenance?.openaiInstructionsSha256, promptHash(''));
    assert.equal(entry.openaiInstructionsChangedFromBaseline, true);
    assert.equal(entry.openaiInstructions, OPENAI_CLINICAL_INSTRUCTIONS);
    assert.equal(entry.openaiInstructionsSha256, promptHash(OPENAI_CLINICAL_INSTRUCTIONS));
    assert.equal(entry.effectivePromptsIdentical, false);
  }
  const html = renderComparisonHtml(compared, '2026-11-11');
  assert.match(html, /동일한 앱 프롬프트를 전달하며 OpenAI에만 승인된 짧은 보완 지시를 추가합니다/);
  assert.match(html, /출력 형식 설정과 음성 처리 방식은 엔진별로 다릅니다/);
  assert.match(html, /기존 Gemini 결과 재사용/);
  assert.match(html, /bcd998055187bbfd4dc223e14dbaa10b09ebf510/);
  assert.match(html, /기존 비교 대비 OpenAI 추가 지시 변경: 예/);
  assert.match(html, /전체 지시가 동일한 비교는 아닙니다/);
  assert.ok(html.includes(OPENAI_CLINICAL_INSTRUCTIONS));
  // The current checkpoint is authoritative; the same baseline must never overwrite or repeat new Astra results.
  const resumed = await compareCases(cases, {
    gemini: async () => { throw Error('unexpected repeat'); }, 'gpt-astra': async () => { throw Error('unexpected repeat'); },
  }, { baseline, resume: compared });
  assert.deepEqual(resumed, compared);
});

test('legacy baseline without instruction metadata preserves unknown provenance and never reuses Astra', async () => {
  const baseline = await makeBaseline([sample]);
  delete baseline.cases[0].openaiInstructions;
  delete baseline.cases[0].openaiInstructionsSha256;
  delete baseline.cases[0].effectivePromptsIdentical;
  let calls = 0;
  const compared = await compareCases([sample], {
    gemini: async () => { throw Error('must reuse only existing Gemini result'); },
    'gpt-astra': async item => { calls++; return baselineOutput(item, 'gpt-astra'); },
  }, { baseline });
  assert.equal(calls, 1);
  assert.equal(compared[0].runs[0].provenance?.openaiInstructionsSha256, null);
  assert.equal(compared[0].openaiInstructionsChangedFromBaseline, true);
  assert.equal(compared[0].effectivePromptsIdentical, false);
});

test('baseline validation rejects stale inputs, unsafe shapes, wrong models and incomplete reports before any call or write', async () => {
  const cases = [sample, { ...sample, id: 'later', kind: 'followup' as const }], baseline = await makeBaseline(cases);
  const corruptions = [
    (report: any) => { report.synthetic = false; },
    (report: any) => { report.evaluatorCommit = 'invalid'; },
    (report: any) => { report.cases.pop(); },
    (report: any) => { report.cases[1] = report.cases[0]; },
    (report: any) => { report.cases[1].id = 'other-case'; },
    (report: any) => { report.cases[1].kind = 'chart'; },
    (report: any) => { report.cases[1].prompt += ' changed'; report.cases[1].promptSha256 = promptHash(report.cases[1].prompt); },
    (report: any) => { report.cases[1].promptSha256 = 'stale'; },
    (report: any) => { report.cases[1].audio = { mimeType: 'audio/wav', sha256: 'a'.repeat(64), bytes: 1 }; },
    (report: any) => { report.cases[1].runs.reverse(); },
    (report: any) => { report.cases[1].runs[0].status = 'failed'; },
    (report: any) => { report.cases[1].runs.pop(); },
    (report: any) => { report.cases[1].runs[0].actualModel = report.cases[1].runs[0].result.model = 'unexpected-gemini'; },
    (report: any) => { report.cases[1].runs[1].actualModel = report.cases[1].runs[1].result.model = 'unexpected-astra'; },
    (report: any) => { report.cases[1].runs[0].result.engine = 'gpt-astra'; },
    (report: any) => { report.cases[1].runs[0].result.text = { unexpected: true }; },
    (report: any) => { report.cases[1].runs[0].result.secret = 'not-a-result-field'; },
    (report: any) => { report.cases[0].runs[0].result.herbsRecipe = [{ 합방_처방: [42] }]; },
    (report: any) => { report.cases[0].openaiInstructions = 'old instructions'; report.cases[0].openaiInstructionsSha256 = 'wrong'; },
  ];
  let calls = 0, writes = 0;
  const clients = { gemini: async () => { calls++; return {}; }, 'gpt-astra': async () => { calls++; return {}; } };
  for (const corrupt of corruptions) {
    const changed = structuredClone(baseline); corrupt(changed);
    await assert.rejects(compareCases(cases, clients, { baseline: changed, onCheckpoint: () => { writes++; } }), /Invalid comparison baseline/);
  }
  await assert.rejects(compareCases([sample], clients, { baseline }), /Invalid comparison baseline/);
  assert.equal(calls, 0); assert.equal(writes, 0);
});

test('baseline audio identity is checked and retired nonempty instructions invalidate resume even with a valid baseline', async () => {
  const item = { ...sample, audioData: { mimeType: 'audio/wav', data: Buffer.from('audio A').toString('base64') } };
  const baseline = await makeBaseline([item]);
  let calls = 0;
  const clients = { gemini: async () => { calls++; return {}; }, 'gpt-astra': async value => { calls++; return baselineOutput(value, 'gpt-astra'); } };
  await assert.rejects(compareCases([{ ...item, audioData: { ...item.audioData, data: Buffer.from('audio B').toString('base64') } }], clients, { baseline }), /Invalid comparison baseline/);
  assert.equal(calls, 0);
  const retiredInstructions = "아래 원장 지침의 치료 목표·선택 기준·조제 방식·어조를 그대로 따르라. 지침에 없는 관찰 우선·치료 축소·단독 처방 우선 원칙을 임의로 추가하지 말고, 생활지도나 반복적인 유보 문구로 구체적인 치료·처방 제안을 대신하지 마라. 치료 선택에 영향을 주는 환자별 금기·위험 신호·핵심 정보 누락은 해당 판단에 연결해 간결하게 밝히고, 입력에 없는 사실이나 시행 여부는 만들지 마라.";
  baseline.cases[0].openaiInstructions = retiredInstructions;
  baseline.cases[0].openaiInstructionsSha256 = promptHash(retiredInstructions);
  baseline.cases[0].effectivePromptsIdentical = false;
  const current = await compareCases([item], clients, { baseline });
  assert.equal(current[0].openaiInstructions, OPENAI_CLINICAL_INSTRUCTIONS);
  assert.equal(current[0].openaiInstructionsChangedFromBaseline, true);
  assert.equal(current[0].runs[0].provenance?.openaiInstructionsSha256, promptHash(retiredInstructions));
  current[0].openaiInstructions = retiredInstructions;
  current[0].openaiInstructionsSha256 = promptHash(retiredInstructions);
  calls = 0;
  await assert.rejects(compareCases([item], clients, { baseline, resume: current }), /Invalid comparison checkpoint/);
  assert.equal(calls, 0);
});

test('baseline CLI dry run validates the latest unchanged-prompt report without keys and reports seven Astra-only pending requests', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ori-baseline-'));
  try {
    const baseline = await makeBaseline(await prepareCases());
    const path = join(out, 'baseline.json');
    await writeFile(path, JSON.stringify(baseline));
    assert.deepEqual(await readComparisonBaseline(path), baseline);
    const cli = fileURLToPath(new URL('../scripts/compare-ai.ts', import.meta.url));
    const env = { ...process.env, OPENAI_API_KEY: '', GEMINI_API_KEY: '' };
    const dry = spawnSync(process.execPath, ['--experimental-strip-types', cli, '--dry-run', '--baseline', path], { env, encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    const manifest = JSON.parse(dry.stdout);
    assert.deepEqual(manifest.pendingRequests, { gemini: 0, 'gpt-astra': 7 });
    assert.equal(manifest.effectivePromptsIdentical, false);
    assert.ok(manifest.cases.every((entry: any) => entry.openaiInstructionsSha256 === promptHash(OPENAI_CLINICAL_INSTRUCTIONS)));
    const subset = spawnSync(process.execPath, ['--experimental-strip-types', cli, '--dry-run', '--baseline', path, '--case', 'chart-mild-pain'], { env, encoding: 'utf8' });
    assert.equal(subset.status, 2); assert.match(subset.stderr, /Invalid comparison baseline/);
    await writeFile(path, 'private invalid JSON');
    await assert.rejects(readComparisonBaseline(path), /Invalid comparison baseline/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('baseline and output must be separate files, including Windows case aliases', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ori-baseline-path-'));
  try {
    const path = join(out, 'comparison.json');
    await writeFile(path, 'original baseline');
    await assert.rejects(assertSeparateBaselineOutput(path, out), /Baseline must be separate/);
    if (process.platform === 'win32') {
      await assert.rejects(assertSeparateBaselineOutput(path.toUpperCase(), out.toLowerCase()), /Baseline must be separate/);
    }
    await assertSeparateBaselineOutput(path, join(out, 'new-output'));
    assert.equal(await readFile(path, 'utf8'), 'original baseline');
  } finally { await rm(out, { recursive: true, force: true }); }
});
