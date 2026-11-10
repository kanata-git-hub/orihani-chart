import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareCases, prepareCases, promptHash, renderComparisonHtml, writeComparison } from '../scripts/compare-ai.ts';
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
  assert.equal(live.status, 1);
  assert.match(live.stderr, /No request was sent/);
  assert.doesNotMatch(live.stderr, /\n\s+at /);
});
