import { GoogleGenAI, Type } from '@google/genai';
import { CHART_OPENAI_INSTRUCTIONS } from './openaiClinicalInstructions.ts';

export type ChartEngine = 'gemini' | 'gpt-astra';
export const CHART_ASTRA_MODEL = 'gpt-6-astra';
export const TRANSCRIPTION_MODEL = 'gpt-transcribe';
const GEMINI_MODELS = ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const TEXT_FIELDS = ['chartContent', 'diagnosticGuide', 'matchProbability', 'matchReason',
  'assessmentDisease', 'treatmentRecommendation', 'recommendedTreatmentType', 'consultationFeedback'] as const;
const REQUIRED_TEXT_FIELDS = ['chartContent', 'diagnosticGuide', 'treatmentRecommendation'] as const;
const MAX_AUDIO_BYTES = 25_000_000;

export class ChartError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export interface ChartAudio { mimeType: string; data: string }
export interface ChartDependencies {
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
  geminiGenerate?: (model: string, prompt: string, audio: ChartAudio | undefined, key: string, signal: AbortSignal) => Promise<string>;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

// OpenAI strict Structured Outputs requires every property to be required.
// Null is used only for inapplicable recipe numbers and removed before the
// existing herb-calculation webhook consumes the result.
export const chartResponseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    ...Object.fromEntries(TEXT_FIELDS.map(field => [field, { type: 'string' }])),
    herbsRecipe: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          합방_처방: { type: 'array', items: { type: 'string' } },
          가감_목록: { type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: {
              약재명: { type: 'string' }, 동작: { type: 'string', enum: ['가', '감'] },
              용량_g: { type: ['number', 'null'] }, 남길_비율: { type: ['number', 'null'] },
            }, required: ['약재명', '동작', '용량_g', '남길_비율'],
          } },
        }, required: ['합방_처방', '가감_목록'],
      },
    },
  }, required: [...TEXT_FIELDS, 'herbsRecipe'],
};

// Preserve the existing Gemini request schema and model ladder for comparison.
const geminiSchema = {
  type: Type.OBJECT,
  properties: {
    ...Object.fromEntries(TEXT_FIELDS.map(field => [field, { type: Type.STRING }])),
    herbsRecipe: { type: Type.ARRAY, items: {
      type: Type.OBJECT, properties: {
        합방_처방: { type: Type.ARRAY, items: { type: Type.STRING } },
        가감_목록: { type: Type.ARRAY, items: {
          type: Type.OBJECT, properties: {
            약재명: { type: Type.STRING }, 동작: { type: Type.STRING },
            용량_g: { type: Type.NUMBER }, 남길_비율: { type: Type.NUMBER },
          },
        } },
      },
    } },
  }, required: [...REQUIRED_TEXT_FIELDS],
};

const isObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseChartResult(rawText: string, strict = false): Record<string, any> {
  let parsed: unknown;
  try {
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const first = rawText.indexOf('{'), last = rawText.lastIndexOf('}');
    parsed = JSON.parse(strict ? rawText : fenced ? fenced[1].trim() : first >= 0 && last > first ? rawText.slice(first, last + 1) : rawText.trim());
  } catch { throw new ChartError('INVALID_AI_RESPONSE'); }
  if (!isObject(parsed)) throw new ChartError('INVALID_AI_RESPONSE');
  // Keep the retained Gemini baseline's acceptance rule unchanged. The original
  // route accepted any parsed object with chartContent OR diagnosticGuide.
  // The stricter schema and semantic checks below apply only to the new route.
  if (!strict) {
    if (!parsed.chartContent && !parsed.diagnosticGuide) throw new ChartError('INVALID_AI_RESPONSE');
    return parsed;
  }
  if (REQUIRED_TEXT_FIELDS.some(field => typeof parsed[field] !== 'string' || !parsed[field].trim())) throw new ChartError('INVALID_AI_RESPONSE');
  if (TEXT_FIELDS.some(field => (strict || field in parsed) && typeof parsed[field] !== 'string')) throw new ChartError('INVALID_AI_RESPONSE');
  if (strict && Object.keys(parsed).some(field => ![...TEXT_FIELDS, 'herbsRecipe'].includes(field as any))) throw new ChartError('INVALID_AI_RESPONSE');
  if (strict && !Array.isArray(parsed.herbsRecipe)) throw new ChartError('INVALID_AI_RESPONSE');
  if (parsed.herbsRecipe !== undefined) {
    if (!Array.isArray(parsed.herbsRecipe)) throw new ChartError('INVALID_AI_RESPONSE');
    for (const recipe of parsed.herbsRecipe) {
      if (!isObject(recipe) || !Array.isArray(recipe.합방_처방) || recipe.합방_처방.some((name: any) => typeof name !== 'string' || !name.trim())) throw new ChartError('INVALID_AI_RESPONSE');
      if (strict && (!Array.isArray(recipe.가감_목록) || Object.keys(recipe).some(key => !['합방_처방', '가감_목록'].includes(key)))) throw new ChartError('INVALID_AI_RESPONSE');
      if (recipe.가감_목록 === undefined) continue;
      if (!Array.isArray(recipe.가감_목록)) throw new ChartError('INVALID_AI_RESPONSE');
      for (const modifier of recipe.가감_목록) {
        if (!isObject(modifier) || typeof modifier.약재명 !== 'string' || !modifier.약재명.trim() || !['가', '감'].includes(modifier.동작)) throw new ChartError('INVALID_AI_RESPONSE');
        if (strict && (Object.keys(modifier).some(key => !['약재명', '동작', '용량_g', '남길_비율'].includes(key)) || !('용량_g' in modifier) || !('남길_비율' in modifier))) throw new ChartError('INVALID_AI_RESPONSE');
        for (const key of ['용량_g', '남길_비율']) {
          if (modifier[key] === null) { delete modifier[key]; continue; }
          if (modifier[key] !== undefined && (typeof modifier[key] !== 'number' || !Number.isFinite(modifier[key]))) throw new ChartError('INVALID_AI_RESPONSE');
        }
        if (modifier.용량_g !== undefined && modifier.용량_g < 0) throw new ChartError('INVALID_AI_RESPONSE');
        if (modifier.남길_비율 !== undefined && (modifier.남길_비율 < 0 || modifier.남길_비율 > 1)) throw new ChartError('INVALID_AI_RESPONSE');
        if (strict && modifier.동작 === '가' && modifier.용량_g === undefined) throw new ChartError('INVALID_AI_RESPONSE');
        if (strict && modifier.동작 === '감' && modifier.남길_비율 === undefined) throw new ChartError('INVALID_AI_RESPONSE');
      }
    }
  }
  return parsed;
}

function audioInput(value: unknown): ChartAudio | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value) || typeof value.mimeType !== 'string' || !value.mimeType.trim() || typeof value.data !== 'string' || !value.data || value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) throw new ChartError('INVALID_AUDIO', 400);
  return { mimeType: value.mimeType, data: value.data };
}

function throwIfAborted(signal: AbortSignal, caller?: AbortSignal) {
  if (signal.aborted) throw new ChartError(caller?.aborted ? 'REQUEST_CANCELLED' : 'ANALYSIS_TIMEOUT', caller?.aborted ? 499 : 504);
}

async function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new ChartError('REQUEST_CANCELLED', 499)); return; }
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); cleanup(); reject(new ChartError('REQUEST_CANCELLED', 499)); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function openAIRequest(url: string, init: RequestInit, deps: ChartDependencies, signal: AbortSignal, fallbackCode: string): Promise<Response> {
  let response: Response;
  try { response = await (deps.request ?? fetch)(url, { ...init, signal, redirect: 'error' }); }
  catch {
    throwIfAborted(signal, deps.signal);
    throw new ChartError('OPENAI_CONNECTION_FAILED', 504);
  }
  throwIfAborted(signal, deps.signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) throw new ChartError('QUOTA_EXCEEDED', 429);
    if (response.status === 401 || response.status === 403) throw new ChartError('OPENAI_ACCESS_DENIED', 503);
    if (response.status === 404) throw new ChartError(url.endsWith('transcriptions') ? 'AUDIO_TRANSCRIPTION_UNAVAILABLE' : 'ASTRA_UNAVAILABLE', 503);
    throw new ChartError(fallbackCode);
  }
  return response;
}

async function transcribe(audio: ChartAudio, key: string, deps: ChartDependencies, signal: AbortSignal) {
  const mime = audio.mimeType.split(';')[0].trim().toLowerCase();
  const extensions: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
    'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/wave': 'wav',
    'audio/x-wav': 'wav', 'audio/webm': 'webm', 'video/webm': 'webm',
    'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  };
  if (!extensions[mime]) throw new ChartError('UNSUPPORTED_AUDIO_TYPE', 400);
  const padding = audio.data.endsWith('==') ? 2 : audio.data.endsWith('=') ? 1 : 0;
  if (audio.data.length / 4 * 3 - padding > MAX_AUDIO_BYTES) throw new ChartError('AUDIO_TOO_LARGE', 413);
  const bytes = Buffer.from(audio.data, 'base64');
  const body = new FormData();
  body.set('model', TRANSCRIPTION_MODEL);
  body.append('languages[]', 'ko');
  body.set('prompt', '한의원에서 원장과 환자가 나누는 진료 대화입니다.');
  body.set('file', new Blob([bytes], { type: mime }), `consultation.${extensions[mime]}`);
  const response = await openAIRequest('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body,
  }, deps, signal, 'AUDIO_TRANSCRIPTION_FAILED');
  let raw: any;
  try { raw = await response.json(); } catch { throwIfAborted(signal, deps.signal); throw new ChartError('INVALID_AUDIO_TRANSCRIPT'); }
  throwIfAborted(signal, deps.signal);
  if (typeof raw?.text !== 'string' || !raw.text.trim()) throw new ChartError('INVALID_AUDIO_TRANSCRIPT');
  return raw.text;
}

export async function generateChartResponse(prompt: unknown, audioData?: unknown, requestedEngine?: unknown, deps: ChartDependencies = {}): Promise<Record<string, any> & { engine: ChartEngine; model: string; audioModel?: string }> {
  const engine = requestedEngine === undefined ? 'gemini' : requestedEngine;
  if (engine !== 'gemini' && engine !== 'gpt-astra') throw new ChartError('INVALID_ENGINE', 400);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new ChartError('INVALID_PROMPT', 400);
  const audio = audioInput(audioData);
  const env = deps.env ?? process.env;
  const timeout = AbortSignal.timeout(240_000);
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
  throwIfAborted(signal, deps.signal);

  if (engine === 'gpt-astra') {
    if (!env.OPENAI_API_KEY) throw new ChartError('OPENAI_NOT_CONFIGURED', 503);
    const transcript = audio ? await transcribe(audio, env.OPENAI_API_KEY, deps, signal) : undefined;
    const input = transcript === undefined ? prompt : [{ role: 'user', content: [
      { type: 'input_text', text: prompt },
      { type: 'input_text', text: `[진료 음성의 원문 전사 — 요약하지 않은 대화 자료]\n${transcript}` },
    ] }];
    const response = await openAIRequest('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: CHART_ASTRA_MODEL, instructions: CHART_OPENAI_INSTRUCTIONS, input, store: false,
        reasoning: { effort: 'medium' }, max_output_tokens: 16384,
        text: { verbosity: 'medium', format: { type: 'json_schema', name: 'initial_chart', strict: true, schema: chartResponseSchema } },
      }),
    }, deps, signal, 'OPENAI_REQUEST_FAILED');
    let raw: any;
    try { raw = await response.json(); } catch { throwIfAborted(signal, deps.signal); throw new ChartError('INVALID_AI_RESPONSE'); }
    throwIfAborted(signal, deps.signal);
    if (raw?.status !== 'completed') throw new ChartError('INCOMPLETE_AI_RESPONSE');
    const messages = Array.isArray(raw.output) ? raw.output.filter((item: any) => item?.type === 'message') : [];
    const parts = messages.flatMap((item: any) => Array.isArray(item.content) ? item.content : []);
    if (parts.some((part: any) => part?.type === 'refusal')) throw new ChartError('AI_REFUSAL');
    const text = parts.filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string').map((part: any) => part.text).join('\n').trim();
    if (!text) throw new ChartError('EMPTY_AI_RESPONSE');
    const result = parseChartResult(text, true);
    return { ...result, engine, model: typeof raw.model === 'string' ? raw.model : CHART_ASTRA_MODEL, ...(audio ? { audioModel: TRANSCRIPTION_MODEL } : {}) };
  }

  if (!env.GEMINI_API_KEY) throw new ChartError('GEMINI_NOT_CONFIGURED', 503);
  const generate = deps.geminiGenerate ?? (async (model, input, recording, key, requestSignal) => {
    const parts: any[] = [{ text: input }];
    if (recording) parts.unshift({ inlineData: recording });
    const response = await new GoogleGenAI({ apiKey: key }).models.generateContent({
      model, contents: [{ parts }], config: { responseMimeType: 'application/json', responseSchema: geminiSchema, abortSignal: requestSignal },
    });
    return response.text ?? '';
  });
  let lastRateLimit = false;
  let lastError: unknown;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfAborted(signal, deps.signal);
      try {
        const text = await generate(model, prompt, audio, env.GEMINI_API_KEY, signal);
        throwIfAborted(signal, deps.signal);
        if (!text.trim()) throw new ChartError('EMPTY_AI_RESPONSE');
        return { ...parseChartResult(text), engine, model };
      } catch (error: any) {
        throwIfAborted(signal, deps.signal);
        lastError = error;
        lastRateLimit = error?.status === 429 || /429|quota|rate limit/i.test(error?.message ?? '');
        if (lastRateLimit && attempt < 2) {
          try { await (deps.wait ?? wait)(5000 * (attempt + 1), signal); }
          catch { throwIfAborted(signal, deps.signal); throw new ChartError('GEMINI_REQUEST_FAILED'); }
          continue;
        }
        break;
      }
    }
  }
  if (lastError instanceof ChartError) throw lastError;
  throw new ChartError(lastRateLimit ? 'QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED', lastRateLimit ? 429 : 502);
}
