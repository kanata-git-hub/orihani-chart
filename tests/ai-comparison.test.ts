import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareCases, prepareCases, promptHash, readComparisonCheckpoint, renderComparisonHtml, writeComparison } from '../scripts/compare-ai.ts';
import type { ComparisonCase } from '../scripts/comparisonCases.ts';

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
