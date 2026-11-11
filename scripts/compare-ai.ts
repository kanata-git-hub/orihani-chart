import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createComparisonCases, SYNTHETIC_AUDIO_SCRIPT } from './comparisonCases.ts';
import type { ComparisonCase, PromptFactories } from './comparisonCases.ts';
import { OPENAI_CLINICAL_INSTRUCTIONS } from '../openaiClinicalInstructions.ts';

export type ComparisonEngine = 'gemini' | 'gpt-astra';
export type ComparisonClients = Record<ComparisonEngine, (item: ComparisonCase) => Promise<unknown>>;
export interface ComparisonRun {
  engine: ComparisonEngine;
  status: 'completed' | 'failed';
  durationMs: number;
  actualModel?: string;
  audioModel?: string;
  result?: unknown;
  error?: { code: string; status?: number };
  provenance?: { source: 'baseline'; generatedAt: string; evaluatorCommit: string; openaiInstructionsSha256: string | null };
}
export interface ComparedCase {
  id: string;
  title: string;
  kind: ComparisonCase['kind'];
  synthetic: true;
  prompt: string;
  promptSha256: string;
  openaiInstructions: string;
  openaiInstructionsSha256: string;
  effectivePromptsIdentical: false;
  openaiInstructionsChangedFromBaseline?: boolean;
  reviewPoints: string[];
  audio?: { mimeType: string; sha256: string; bytes: number };
  runs: ComparisonRun[];
}
export interface ComparisonProgress {
  index: number;
  total: number;
  caseId: string;
  engine: ComparisonEngine;
  status: 'started' | 'completed' | 'failed' | 'reused';
}
export interface ComparisonOptions {
  resume?: unknown;
  baseline?: unknown;
  onProgress?: (event: ComparisonProgress) => void | Promise<void>;
  onCheckpoint?: (cases: ComparedCase[]) => void | Promise<void>;
}

export const RUBRIC = [
  ['입력 사실 보존', '부위·좌우·기간·수치·부정 표현·처방 이력의 누락이나 변조가 없는지 비교합니다.'],
  ['처방 설정 준수', '쯔무라 기반, 최대량 합방, 비위 상태, 가감과 비율, 재고 제약을 실제 후보에 반영하는지 확인합니다.'],
  ['다음 선택의 구체성', '현재 가장 유망한 전략과 이유, 이전과 달라지는 점, 유지·전환 기준을 제시하는지 비교합니다.'],
  ['경과 해석', '주 증상과 동반 증상, 확인된 반응과 미검증 가설을 구분하고 근거 없는 과거 실패 반복을 피하는지 확인합니다.'],
  ['어조와 분량', '기존 경어체·짧은 항목·볼드·제목을 유지하고, 일반론·반복적인 단서가 실질적 제안을 대체하지 않는지 직접 읽고 비교합니다.'],
  ['출력 계약', '차트 JSON, 정해진 재평가 제목, 본문과 처방 JSON의 순서·가감 일치, 화면 후처리를 확인합니다.'],
  ['허위 정보와 중요한 금기', '실제로 없는 논문·진료 사실·함량·효능 보장 또는 확인된 알레르기 무시가 없는지 확인합니다.'],
  ['실행 품질과 음성', '오류율·응답 시간과 음성의 화자·숫자·약재명·부정 표현 보존, 대화 피드백을 확인합니다.'],
] as const;

const FAILURE_CODES = new Set(['INVALID_ENGINE', 'INVALID_PROMPT', 'INVALID_AUDIO', 'AUDIO_TOO_LARGE', 'UNSUPPORTED_AUDIO', 'UNSUPPORTED_AUDIO_TYPE',
  'OPENAI_NOT_CONFIGURED', 'GEMINI_NOT_CONFIGURED', 'OPENAI_ACCESS_DENIED', 'ASTRA_UNAVAILABLE', 'QUOTA_EXCEEDED',
  'ANALYSIS_TIMEOUT', 'OPENAI_CONNECTION_FAILED', 'OPENAI_REQUEST_FAILED', 'INVALID_AI_RESPONSE', 'INCOMPLETE_AI_RESPONSE',
  'AI_REFUSAL', 'EMPTY_AI_RESPONSE', 'GEMINI_REQUEST_FAILED', 'TRANSCRIPTION_FAILED', 'INVALID_TRANSCRIPTION',
  'AUDIO_TRANSCRIPTION_FAILED', 'AUDIO_TRANSCRIPTION_EMPTY', 'AUDIO_TRANSCRIPTION_UNAVAILABLE', 'INVALID_AUDIO_TRANSCRIPT', 'REQUEST_CANCELLED', 'CHART_GENERATION_FAILED']);

export const promptHash = (prompt: string) => createHash('sha256').update(prompt, 'utf8').digest('hex');
export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

function safeFailure(error: unknown): ComparisonRun['error'] {
  const candidate = error as { message?: unknown; status?: unknown } | null;
  const code = typeof candidate?.message === 'string' && FAILURE_CODES.has(candidate.message) ? candidate.message : 'COMPARISON_REQUEST_FAILED';
  const status = typeof candidate?.status === 'number' && Number.isInteger(candidate.status) && candidate.status >= 400 && candidate.status <= 599 ? candidate.status : undefined;
  return { code, ...(status ? { status } : {}) };
}

const ENGINES = ['gemini', 'gpt-astra'] as const;
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalidCheckpoint = () => Error('Invalid comparison checkpoint. Inputs or saved results differ; no existing results were replaced. No request was sent.');
const invalidBaseline = () => Error('Invalid comparison baseline. A complete matching synthetic report is required. No request was sent.');
// Use the same instruction as the application engines and reject checkpoints from any other directive.
const OPENAI_INSTRUCTIONS = OPENAI_CLINICAL_INSTRUCTIONS;
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const PROVENANCE_KEYS = ['source', 'generatedAt', 'evaluatorCommit', 'openaiInstructionsSha256'] as const;
const validProvenance = (value: unknown): value is NonNullable<ComparisonRun['provenance']> => isRecord(value) &&
  Object.keys(value).every(key => (PROVENANCE_KEYS as readonly string[]).includes(key)) &&
  value.source === 'baseline' && typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt)) &&
  typeof value.evaluatorCommit === 'string' && /^[a-f0-9]{40}$/.test(value.evaluatorCommit) &&
  (value.openaiInstructionsSha256 === null || validHash(value.openaiInstructionsSha256));

function sameCaseInput(entry: ComparedCase, previous: unknown): boolean {
  if (!isRecord(previous) || previous.synthetic !== true || previous.kind !== entry.kind || previous.id !== entry.id ||
    previous.prompt !== entry.prompt || previous.promptSha256 !== entry.promptSha256 ||
    promptHash(previous.prompt) !== previous.promptSha256) return false;
  return entry.audio ? isRecord(previous.audio) && previous.audio.sha256 === entry.audio.sha256 &&
    previous.audio.mimeType === entry.audio.mimeType && previous.audio.bytes === entry.audio.bytes : previous.audio === undefined;
}

function validateCaseSet(entries: ComparedCase[], saved: unknown, invalid: () => Error, allowEmpty: boolean): asserts saved is Record<string, any>[] {
  if (!Array.isArray(saved)) throw invalid();
  if (allowEmpty && saved.length === 0) return;
  const ids = new Set(entries.map(item => item.id)), savedIds = new Set(saved.map(item => isRecord(item) ? item.id : undefined));
  if (ids.size !== entries.length || savedIds.size !== saved.length || saved.length !== entries.length ||
    [...savedIds].some(id => typeof id !== 'string' || !ids.has(id))) throw invalid();
}

// Validate transport shape, not clinical quality. Preserve known baseline defects such as a missing optional modifier list.
function safeBaselineResult(result: unknown, kind: ComparisonCase['kind']): boolean {
  if (!isRecord(result)) return false;
  const metadata = ['engine', 'model', 'audioModel'];
  if (kind === 'followup') return typeof result.text === 'string' && !!result.text.trim() &&
    Object.keys(result).every(key => [...metadata, 'text'].includes(key));
  const fields = ['chartContent', 'diagnosticGuide', 'matchProbability', 'matchReason', 'assessmentDisease',
    'treatmentRecommendation', 'recommendedTreatmentType', 'consultationFeedback'];
  if (fields.some(key => typeof result[key] !== 'string') || !result.chartContent.trim() ||
    Object.keys(result).some(key => ![...metadata, ...fields, 'herbsRecipe'].includes(key)) || !Array.isArray(result.herbsRecipe)) return false;
  return result.herbsRecipe.every((recipe: unknown) => isRecord(recipe) &&
    Object.keys(recipe).every(key => ['합방_처방', '가감_목록'].includes(key)) && Array.isArray(recipe.합방_처방) &&
    recipe.합방_처방.every((name: unknown) => typeof name === 'string' && !!name.trim()) &&
    (recipe.가감_목록 === undefined || Array.isArray(recipe.가감_목록) && recipe.가감_목록.every((modifier: unknown) => isRecord(modifier) &&
      Object.keys(modifier).every(key => ['약재명', '동작', '용량_g', '남길_비율'].includes(key)) &&
      typeof modifier.약재명 === 'string' && !!modifier.약재명.trim() && ['가', '감'].includes(modifier.동작) &&
      [modifier.용량_g, modifier.남길_비율].every(number => number === undefined || number === null || typeof number === 'number' && Number.isFinite(number) && number >= 0) &&
      (modifier.남길_비율 == null || modifier.남길_비율 <= 1))));
}

function importBaseline(entries: ComparedCase[], raw: unknown): ComparisonRun[] {
  if (!isRecord(raw) || raw.synthetic !== true || raw.reviewStatus !== 'pending_manual_review' ||
    raw.clinicalEquivalence !== 'not_established' || typeof raw.generatedAt !== 'string' || !Number.isFinite(Date.parse(raw.generatedAt)) ||
    typeof raw.evaluatorCommit !== 'string' || !/^[a-f0-9]{40}$/.test(raw.evaluatorCommit) ||
    raw.audioComparisonIncluded !== entries.some(entry => entry.audio)) throw invalidBaseline();
  validateCaseSet(entries, raw.cases, invalidBaseline, false);
  return entries.map(entry => {
    const previous = raw.cases.find((value: any) => value.id === entry.id);
    if (!sameCaseInput(entry, previous) || !Array.isArray(previous.runs) || previous.runs.length !== 2 ||
      typeof previous.title !== 'string' || !Array.isArray(previous.reviewPoints) || previous.reviewPoints.some((point: unknown) => typeof point !== 'string')) throw invalidBaseline();
    if (previous.openaiInstructions !== undefined || previous.openaiInstructionsSha256 !== undefined) {
      if (typeof previous.openaiInstructions !== 'string' || !validHash(previous.openaiInstructionsSha256) ||
        promptHash(previous.openaiInstructions) !== previous.openaiInstructionsSha256) throw invalidBaseline();
    }
    const geminiModels = entry.kind === 'chart' ? ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'] : ['gemini-3.1-pro-preview', 'gemini-3.6-flash'];
    for (const [index, run] of previous.runs.entries()) {
      const engine = ENGINES[index], models = engine === 'gemini' ? geminiModels : ['gpt-6-astra'];
      if (!isRecord(run) || run.engine !== engine || run.status !== 'completed' || !Number.isFinite(run.durationMs) || run.durationMs < 0 ||
        !models.includes(run.actualModel) || !safeBaselineResult(run.result, entry.kind) || run.result.engine !== engine || run.result.model !== run.actualModel ||
        (engine === 'gpt-astra' && entry.audio ? run.audioModel !== 'gpt-transcribe' || run.result.audioModel !== 'gpt-transcribe' :
          run.audioModel !== undefined || run.result.audioModel !== undefined) || run.provenance !== undefined && (engine !== 'gemini' || !validProvenance(run.provenance))) throw invalidBaseline();
    }
    const run = previous.runs[0];
    return { engine: 'gemini', status: 'completed', durationMs: run.durationMs, actualModel: run.actualModel,
      result: structuredClone(run.result), provenance: run.provenance ? structuredClone(run.provenance) : {
        source: 'baseline', generatedAt: raw.generatedAt, evaluatorCommit: raw.evaluatorCommit,
        openaiInstructionsSha256: previous.openaiInstructionsSha256 ?? null,
      } };
  });
}

function restoredRuns(entry: ComparedCase, resume: unknown): ComparisonRun[] {
  if (resume === undefined || Array.isArray(resume) && resume.length === 0) return [];
  if (!Array.isArray(resume)) throw invalidCheckpoint();
  const matches = resume.filter(previous => isRecord(previous) && previous.id === entry.id);
  if (matches.length !== 1) throw invalidCheckpoint();
  const previous = matches[0];
  if (!sameCaseInput(entry, previous) || previous.openaiInstructions !== entry.openaiInstructions ||
    previous.openaiInstructionsSha256 !== entry.openaiInstructionsSha256 || previous.effectivePromptsIdentical !== entry.effectivePromptsIdentical ||
    !Array.isArray(previous.runs) || previous.runs.length > ENGINES.length ||
    previous.runs.some((run: unknown, index: number) => !isRecord(run) || run.engine !== ENGINES[index] || !['completed', 'failed'].includes(run.status))) throw invalidCheckpoint();
  return previous.runs.map((run: any, index: number) => {
    const result = run.result;
    const valid = run.status === 'completed' && Number.isFinite(run.durationMs) && run.durationMs >= 0 &&
      typeof run.actualModel === 'string' && !!run.actualModel.trim() && isRecord(result) &&
      result.engine === ENGINES[index] && result.model === run.actualModel &&
      (run.audioModel === undefined ? result.audioModel === undefined : typeof run.audioModel === 'string' && !!run.audioModel.trim() && result.audioModel === run.audioModel);
    if (run.provenance !== undefined && (index !== 0 || !validProvenance(run.provenance))) throw invalidCheckpoint();
    if (valid) return { engine: ENGINES[index], status: 'completed', durationMs: run.durationMs, actualModel: run.actualModel,
      ...(run.audioModel ? { audioModel: run.audioModel } : {}), ...(run.provenance ? { provenance: structuredClone(run.provenance) } : {}),
      result: structuredClone(result) } as ComparisonRun;
    if (run.status !== 'failed' || !Number.isFinite(run.durationMs) || run.durationMs < 0) throw invalidCheckpoint();
    // Keep failed slots so an independently completed later engine remains available; only failed/missing slots retry.
    return { engine: ENGINES[index], status: 'failed', durationMs: 0, error: { code: 'INVALID_AI_RESPONSE' } } as ComparisonRun;
  });
}

function prepareComparison(cases: ComparisonCase[], options: ComparisonOptions) {
  const items = cases.map(source => {
    if (source.synthetic !== true) throw Error('Only synthetic evaluation cases are accepted.');
    const audioData = source.audioData ? Object.freeze({ ...source.audioData }) : undefined;
    return Object.freeze({ ...source, audioData, reviewPoints: [...source.reviewPoints] });
  });
  const compared = items.map(item => {
    const entry: ComparedCase = { id: item.id, title: item.title, kind: item.kind, synthetic: true, prompt: item.prompt,
      promptSha256: promptHash(item.prompt), openaiInstructions: OPENAI_INSTRUCTIONS,
      openaiInstructionsSha256: promptHash(OPENAI_INSTRUCTIONS), effectivePromptsIdentical: false,
      reviewPoints: [...item.reviewPoints], runs: [] };
    if (item.audioData) {
      const bytes = Buffer.from(item.audioData.data, 'base64');
      entry.audio = { mimeType: item.audioData.mimeType, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    }
    return entry;
  });
  if (options.resume !== undefined) validateCaseSet(compared, options.resume, invalidCheckpoint, true);
  const baseline = options.baseline === undefined ? undefined : importBaseline(compared, options.baseline);
  for (const [index, entry] of compared.entries()) {
    entry.runs = restoredRuns(entry, options.resume);
    if (baseline) {
      const existing = entry.runs[0], imported = baseline[index];
      if (existing?.status === 'completed' && (existing.durationMs !== imported.durationMs || existing.actualModel !== imported.actualModel ||
        JSON.stringify(existing.result) !== JSON.stringify(imported.result) || !existing.provenance ||
        PROVENANCE_KEYS.some(key => existing.provenance![key] !== imported.provenance![key]))) throw invalidCheckpoint();
      entry.runs[0] = baseline[index];
    }
    const provenance = entry.runs[0]?.provenance;
    if (provenance) entry.openaiInstructionsChangedFromBaseline = (provenance.openaiInstructionsSha256 ?? promptHash('')) !== entry.openaiInstructionsSha256;
  }
  return { items, compared };
}

/** Both providers receive the unchanged application prompt; OpenAI also receives the approved short directive. */
export async function compareCases(cases: ComparisonCase[], clients: ComparisonClients, options: ComparisonOptions = {}): Promise<ComparedCase[]> {
  // Validate every baseline/checkpoint case before any paid call or replacement write.
  const { items, compared } = prepareComparison(cases, options);
  for (let caseIndex = 0; caseIndex < items.length; caseIndex++) {
    const item = items[caseIndex], entry = compared[caseIndex];
    for (const [engineIndex, engine] of ENGINES.entries()) {
      const progress = (status: ComparisonProgress['status']) => options.onProgress?.({ index: caseIndex * ENGINES.length + engineIndex + 1,
        total: items.length * ENGINES.length, caseId: item.id, engine, status });
      if (entry.runs[engineIndex]?.status === 'completed') {
        await options.onCheckpoint?.(structuredClone(compared));
        await progress('reused');
        continue;
      }
      await progress('started');
      const started = performance.now();
      try {
        const result = await clients[engine](item);
        const meta = result as { engine?: unknown; model?: unknown; audioModel?: unknown } | null;
        if (meta?.engine !== engine || typeof meta.model !== 'string' || !meta.model.trim()) throw Error('INVALID_AI_RESPONSE');
        entry.runs[engineIndex] = { engine, status: 'completed', durationMs: Math.round(performance.now() - started), actualModel: meta.model,
          ...(typeof meta.audioModel === 'string' ? { audioModel: meta.audioModel } : {}), result };
      } catch (error) {
        entry.runs[engineIndex] = { engine, status: 'failed', durationMs: Math.round(performance.now() - started), error: safeFailure(error) };
      }
      // A storage error must stop paid work, not be misclassified as a provider failure.
      await options.onCheckpoint?.(structuredClone(compared));
      await progress(entry.runs[engineIndex].status);
    }
  }
  return compared;
}

export function renderComparisonHtml(cases: ComparedCase[], generatedAt: string): string {
  const sections = cases.map(item => `<section><h2>${escapeHtml(item.title)}</h2><p><code>${escapeHtml(item.id)}</code> · prompt SHA-256: <code>${escapeHtml(item.promptSha256)}</code></p>
<p>두 엔진에 동일한 앱 프롬프트를 전달하며 OpenAI에만 승인된 짧은 보완 지시를 추가합니다. 전체 지시가 동일한 비교는 아닙니다. 출력 형식 설정과 음성 처리 방식은 엔진별로 다릅니다. OpenAI instructions SHA-256: <code>${escapeHtml(item.openaiInstructionsSha256)}</code>${item.openaiInstructionsChangedFromBaseline !== undefined ? ` · 기존 비교 대비 OpenAI 추가 지시 변경: ${item.openaiInstructionsChangedFromBaseline ? '예' : '아니요'}` : ''}</p>
<ul>${item.reviewPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
<div class="columns">${item.runs.map(run => `<article><h3>${escapeHtml(run.engine)}</h3><p>${escapeHtml(run.status)} · ${run.durationMs} ms · ${escapeHtml(run.actualModel ?? '모델 미확인')}${run.audioModel ? ` · 음성: ${escapeHtml(run.audioModel)}` : ''}</p>${run.provenance ? `<p>기존 Gemini 결과 재사용 · 원본 생성: ${escapeHtml(run.provenance.generatedAt)} · 원본 evaluator: <code>${escapeHtml(run.provenance.evaluatorCommit)}</code></p>` : ''}<pre>${escapeHtml(JSON.stringify(run.status === 'completed' ? run.result : run.error, null, 2))}</pre></article>`).join('')}</div>
<details><summary>OpenAI 추가 지시 원문</summary><pre>${escapeHtml(item.openaiInstructions)}</pre></details>
<details><summary>동일한 원문 프롬프트</summary><pre>${escapeHtml(item.prompt)}</pre></details></section>`).join('\n');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>오리차트 AI 결과 비교</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:28px;color:#28221d;background:#faf8f3}main{max-width:1600px;margin:auto}h1,h2{line-height:1.3}section{margin:28px 0;padding:24px;background:#fff;border:1px solid #d8d0c5;border-radius:10px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}article{min-width:0;background:#f4f1eb;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 ui-monospace,monospace}code{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td,th{text-align:left;vertical-align:top;padding:10px;border:1px solid #d8d0c5}.pending{padding:18px;background:#fff0cb;border:1px solid #be9952}@media(max-width:800px){.columns{grid-template-columns:1fr}body{margin:12px}section{padding:14px}}</style>
<main><h1>오리차트 Gemini / GPT Astra 결과 비교</h1><p>생성: ${escapeHtml(generatedAt)} · 모든 기본 사례는 합성 데이터입니다.</p>
<p class="pending"><strong>품질 판정: 수동 검토 대기.</strong> 요청 완료나 자동 검사 통과는 의학적 동등성·우월성의 증명이 아닙니다. 원장님의 처방 기준과 기존 어조를 결과별로 직접 비교해야 합니다. 운영 기본값 전환 승인을 자동으로 내리지 않습니다.</p>
<p>중단 기준: 입력 사실·처방량·연구 결과를 지어냄, 확인된 알레르기 무시, 치료 제한 위반, 본문과 처방 JSON 불일치, 불완전 출력, 음성 내용의 중대한 오인. 한 항목이라도 있으면 전환 판단을 보류합니다.</p>
<table><thead><tr><th>평가 항목</th><th>수동 확인 기준</th><th>판정</th></tr></thead><tbody>${RUBRIC.map(([name, detail]) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(detail)}</td><td>검토 대기</td></tr>`).join('')}</tbody></table>
<p>${cases.some(item => item.audio) ? '음성 사례 포함: 내용 보존과 최종 화면 후처리는 별도 수동 확인이 필요합니다.' : '음성 비교 미실시: 텍스트 결과만으로 전체 오리차트 전환을 완료 판정하지 않습니다.'} 출력은 앱 엔진 함수의 JSON 결과이며, UI 및 외부 약재 계산 검증을 대신하지 않습니다. 토큰·비용은 현재 엔진 반환값에 포함되지 않아 여기서 추정하지 않습니다.</p>${sections}</main></html>`;
}

export async function writeComparison(cases: ComparedCase[], outDir: string): Promise<{ jsonPath: string; htmlPath: string }> {
  const generatedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  const jsonPath = resolve(outDir, 'comparison.json'), htmlPath = resolve(outDir, 'comparison.html');
  const atomicWrite = async (path: string, contents: string) => {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, contents, { mode: 0o600 }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  };
  // JSON is the resume authority. Commit it last; HTML can be regenerated after interruption.
  await atomicWrite(htmlPath, renderComparisonHtml(cases, generatedAt));
  await atomicWrite(jsonPath, JSON.stringify({ generatedAt, synthetic: true, reviewStatus: 'pending_manual_review', clinicalEquivalence: 'not_established',
    effectivePromptsIdentical: false, comparisonMode: cases.some(item => item.runs.some(run => run.provenance)) ? 'candidate_with_reused_gemini_baseline' : 'both_providers',
    evaluatorCommit: process.env.ORI_COMPARISON_COMMIT || null, audioComparisonIncluded: cases.some(item => item.audio), cases }, null, 2) + '\n');
  return { jsonPath, htmlPath };
}

export async function readComparisonCheckpoint(outDir: string, expectedCommit = process.env.ORI_COMPARISON_COMMIT): Promise<ComparedCase[]> {
  const path = resolve(outDir, 'comparison.json');
  let raw: unknown;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 25_000_000) throw Error('Invalid comparison checkpoint.');
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw Error('Invalid comparison checkpoint. No request was sent.');
  }
  if (!isRecord(raw) || raw.synthetic !== true || raw.reviewStatus !== 'pending_manual_review' || !Array.isArray(raw.cases)) {
    throw Error('Invalid comparison checkpoint. No request was sent.');
  }
  if (raw.evaluatorCommit !== (expectedCommit || null)) throw Error('Comparison checkpoint version differs. Use the matching evaluator or a new output directory. No request was sent.');
  return raw.cases;
}

export async function readComparisonBaseline(path: string): Promise<unknown> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 25_000_000) throw invalidBaseline();
    return JSON.parse(await readFile(path, 'utf8'));
  } catch { throw invalidBaseline(); }
}

export async function assertSeparateBaselineOutput(baselinePath: string, outDir: string): Promise<void> {
  const outputPath = resolve(outDir, 'comparison.json');
  const canonical = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  const conflict = () => Error('Baseline must be separate from the current output report. No request was sent.');
  if (canonical(resolve(baselinePath)) === canonical(outputPath)) throw conflict();
  let existingOutput;
  try { existingOutput = await stat(outputPath); }
  catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return; throw error; }
  const [baselineInfo, baselineReal, outputReal] = await Promise.all([stat(baselinePath), realpath(baselinePath), realpath(outputPath)]);
  if (canonical(baselineReal) === canonical(outputReal) || baselineInfo.ino !== 0 &&
    baselineInfo.ino === existingOutput.ino && baselineInfo.dev === existingOutput.dev) throw conflict();
}

export async function prepareCases(audioData?: ComparisonCase['audioData']): Promise<ComparisonCase[]> {
  // tsx resolves the existing application's extensionless/type-only imports without changing its prompt source.
  const { tsImport } = await import('tsx/esm/api');
  const prompts = await tsImport('../src/services/prompts.ts', import.meta.url) as PromptFactories;
  return createComparisonCases(prompts, audioData);
}

async function main(args: string[]) {
  const values: Record<string, string> = {}, flags = new Set<string>(), caseIds: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--dry-run', '--help', '--resume', '--confirm-synthetic-audio', '--print-audio-script'].includes(arg)) flags.add(arg);
    else if (['--out', '--case', '--audio', '--audio-mime', '--baseline'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing option value.');
      if (arg === '--case') caseIds.push(args[++i]); else values[arg] = args[++i];
    } else throw Error('Unknown option. Use --help.');
  }
  if (flags.has('--help')) { console.log('node --experimental-strip-types scripts/compare-ai.ts [--dry-run] [--case ID] [--out DIR] [--resume --out DIR] [--baseline COMPLETE_SYNTHETIC_REPORT.json] [--audio FILE --confirm-synthetic-audio] [--audio-mime MIME] [--print-audio-script]'); return; }
  if (flags.has('--print-audio-script')) { console.log(SYNTHETIC_AUDIO_SCRIPT); return; }
  let audioData: ComparisonCase['audioData'];
  if (values['--audio']) {
    if (!flags.has('--confirm-synthetic-audio')) throw Error('Audio must be recorded from the synthetic script. Add --confirm-synthetic-audio only for synthetic audio.');
    const mimeByExtension: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
    const mimeType = values['--audio-mime'] || mimeByExtension[extname(values['--audio']).toLowerCase()];
    const supported = new Set(['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-flac']);
    if (!mimeType || !supported.has(mimeType.toLowerCase())) throw Error('Audio MIME type is missing or unsupported by the comparison route.');
    const bytes = await readFile(resolve(values['--audio']));
    if (!bytes.length || bytes.length > 25_000_000) throw Error('Synthetic audio must be non-empty and at most 25,000,000 bytes.');
    audioData = { mimeType, data: bytes.toString('base64') };
  } else if (values['--audio-mime'] || flags.has('--confirm-synthetic-audio')) throw Error('--audio is required for audio options.');
  let cases = await prepareCases(audioData);
  if (caseIds.length) {
    if (caseIds.some(id => !cases.some(item => item.id === id))) throw Error('Unknown or unavailable case ID.');
    cases = cases.filter(item => caseIds.includes(item.id));
  }
  if (flags.has('--resume') && !values['--out']) throw Error('--resume requires --out with the previous output directory.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = resolve(values['--out'] || resolve(repo, 'generated/ai-comparison', stamp));
  const resume = flags.has('--resume') ? await readComparisonCheckpoint(outDir) : undefined;
  const baseline = values['--baseline'] ? await readComparisonBaseline(resolve(values['--baseline'])) : undefined;
  if (values['--baseline']) await assertSeparateBaselineOutput(resolve(values['--baseline']), outDir);
  const prepared = prepareComparison(cases, { resume, baseline });
  if (flags.has('--dry-run')) {
    console.log(JSON.stringify({ mode: 'dry-run', paidCalls: 0, synthetic: true, audioComparisonIncluded: cases.some(item => item.audioData),
      baselineIncluded: baseline !== undefined, effectivePromptsIdentical: false,
      pendingRequests: Object.fromEntries(ENGINES.map((engine, index) => [engine, prepared.compared.filter(item => item.runs[index]?.status !== 'completed').length])),
      cases: prepared.compared.map(({ id, kind, title, prompt, promptSha256, openaiInstructionsSha256 }) => ({ id, kind, title, promptSha256, promptCharacters: prompt.length, openaiInstructionsSha256 })) }, null, 2));
    return;
  }
  if (prepared.compared.some(item => item.runs[1]?.status !== 'completed') && !process.env.OPENAI_API_KEY?.trim() ||
    prepared.compared.some(item => item.runs[0]?.status !== 'completed') && !process.env.GEMINI_API_KEY?.trim()) throw Error('Required provider credentials are missing from the process environment. No request was sent.');
  const [{ generateChartResponse }, { generateFollowUpResponse }] = await Promise.all([import('../chartEngine.ts'), import('../followUpEngine.ts')]);
  const client = (engine: ComparisonEngine) => (item: ComparisonCase) => item.kind === 'chart'
    ? generateChartResponse(item.prompt, item.audioData, engine)
    : generateFollowUpResponse(item.prompt, engine);
  const compared = await compareCases(cases, { gemini: client('gemini'), 'gpt-astra': client('gpt-astra') }, {
    resume, baseline,
    onProgress: event => { console.log(`ORI_PROGRESS ${JSON.stringify(event)}`); },
    onCheckpoint: entries => writeComparison(entries, outDir).then(() => undefined),
  });
  const files = await writeComparison(compared, outDir);
  const failed = compared.reduce((sum, item) => sum + item.runs.filter(run => run.status === 'failed').length, 0);
  console.log(JSON.stringify({ ...files, cases: compared.length, failedCalls: failed, reviewStatus: 'pending_manual_review', clinicalEquivalence: 'not_established' }, null, 2));
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    // Only locally produced setup errors are readable; arbitrary request errors are masked inside compareCases.
    const allowed = /^(Missing option value|Unknown option|Audio must be recorded|Audio MIME type|Synthetic audio must|--audio is required|--resume requires|Unknown or unavailable case|Required provider credentials|Invalid comparison checkpoint|Comparison checkpoint version differs|Invalid comparison baseline|Baseline must be separate)/;
    console.error(allowed.test(error?.message || '') ? error.message : 'Comparison setup failed. Check dependencies, synthetic input file and output directory. No secret details are logged.');
    process.exitCode = 2;
  });
}
