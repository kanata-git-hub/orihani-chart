import { GoogleGenAI } from '@google/genai';

export type FollowUpEngine = 'gemini' | 'gpt-astra';
export const ASTRA_MODEL = 'gpt-6-astra';
const GEMINI_MODELS = ['gemini-3.1-pro-preview', 'gemini-3.6-flash'];

export class FollowUpError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

interface Dependencies {
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
  geminiGenerate?: (model: string, prompt: string, key: string) => Promise<string>;
  wait?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
}

export async function generateFollowUpResponse(prompt: unknown, requestedEngine?: unknown, deps: Dependencies = {}) {
  const engine = requestedEngine === undefined ? 'gemini' : requestedEngine;
  if (engine !== 'gemini' && engine !== 'gpt-astra') throw new FollowUpError('INVALID_ENGINE', 400);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new FollowUpError('INVALID_PROMPT', 400);
  const env = deps.env ?? process.env;

  if (engine === 'gpt-astra') {
    if (!env.OPENAI_API_KEY) throw new FollowUpError('OPENAI_NOT_CONFIGURED', 503);
    const timeout = AbortSignal.timeout(240_000);
    let response: Response;
    try {
      response = await (deps.request ?? fetch)('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: ASTRA_MODEL, input: prompt, store: false,
          reasoning: { effort: 'medium' }, max_output_tokens: 16384 }),
        signal: deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout,
        redirect: 'error',
      });
    } catch {
      throw new FollowUpError(timeout.aborted ? 'ANALYSIS_TIMEOUT' : 'OPENAI_CONNECTION_FAILED', 504);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new FollowUpError('QUOTA_EXCEEDED', 429);
      if (response.status === 401 || response.status === 403) throw new FollowUpError('OPENAI_ACCESS_DENIED', 503);
      if (response.status === 404) throw new FollowUpError('ASTRA_UNAVAILABLE', 503);
      throw new FollowUpError('OPENAI_REQUEST_FAILED');
    }
    let raw: any;
    try { raw = await response.json(); } catch { throw new FollowUpError('INVALID_AI_RESPONSE'); }
    // Incomplete medical output must never be presented as a successful analysis.
    if (raw?.status !== 'completed') throw new FollowUpError('INCOMPLETE_AI_RESPONSE');
    const messages = Array.isArray(raw.output) ? raw.output.filter((item: any) => item?.type === 'message') : [];
    const parts = messages.flatMap((item: any) => Array.isArray(item.content) ? item.content : []);
    if (parts.some((part: any) => part?.type === 'refusal')) throw new FollowUpError('AI_REFUSAL');
    const text = parts.filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
      .map((part: any) => part.text).join('\n').trim();
    if (!text) throw new FollowUpError('EMPTY_AI_RESPONSE');
    return { text, engine, model: typeof raw.model === 'string' ? raw.model : ASTRA_MODEL };
  }

  const key = env.GEMINI_API_KEY;
  if (!key) throw new FollowUpError('GEMINI_NOT_CONFIGURED', 503);
  const generate = deps.geminiGenerate ?? (async (model: string, input: string, apiKey: string) => {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model, contents: [{ role: 'user', parts: [{ text: input }] }],
    });
    return response.text ?? '';
  });
  const wait = deps.wait ?? (async (milliseconds: number) => { await new Promise(resolve => setTimeout(resolve, milliseconds)); });
  let lastRateLimit = false;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await generate(model, prompt, key);
        if (!text.trim()) throw new FollowUpError('EMPTY_AI_RESPONSE');
        return { text, engine, model };
      } catch (error: any) {
        lastRateLimit = error?.status === 429 || /429|quota|rate limit/i.test(error?.message ?? '');
        if (lastRateLimit && attempt === 0) { await wait(2000); continue; }
        break;
      }
    }
  }
  throw new FollowUpError(lastRateLimit ? 'QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED', lastRateLimit ? 429 : 502);
}
