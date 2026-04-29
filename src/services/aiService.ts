import { GoogleGenAI } from "@google/genai";
import { PatientBriefing, AnalysisResult } from "../types";
import { generateChartPrompt } from "./prompts";

const executeWithRetry = async <T>(apiCall: () => Promise<T>, maxRetries: number = 3, baseDelayMs: number = 5000): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error: any) {
      const errorMsg = error?.message?.toLowerCase() || '';
      const isRateLimit = error?.status === 429 || errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate limit');
      
      if (isRateLimit && i < maxRetries - 1) {
        const waitTime = baseDelayMs * (i + 1); // 5s, 10s 대기
        console.warn(`[API 쿼터 제한 감지] ${waitTime / 1000}초 후 재시도 합니다... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Maximum retries exceeded");
};

export const generateAIChart = async (
  briefing: PatientBriefing,
  audioData?: { mimeType: string; data: string }
): Promise<AnalysisResult> => {
  const prompt = generateChartPrompt(briefing);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
  
  const contents: any[] = [{ text: prompt }];
  if (audioData) {
    contents.unshift({
      inlineData: {
        mimeType: audioData.mimeType,
        data: audioData.data
      }
    });
  }

  const models = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview"
  ];

  let lastError: any;

  for (const model of models) {
    try {
      const response = await executeWithRetry(() => 
        ai.models.generateContent({
          model: model,
          contents: [{ parts: contents }],
          config: {
            responseMimeType: "application/json",
          }
        })
      );
      return JSON.parse(response.text || '{}');
    } catch (err) {
      console.warn(`Model ${model} failed. Trying next...`, err);
      lastError = err;
    }
  }

  throw lastError;
};

export const generateFollowUpAnalysis = async (
  prompt: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  // 최고 지능 Pro 모델을 우선 시도하고, 쿼터 제한이나 오류 시 빠른 처리를 위해 Flash 모델로 우회
  const models = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview"
  ];

  let lastError: any;

  for (const model of models) {
    try {
      // 분석 요청이므로 재시도 방식을 사용하여 호출합니다.
      const response = await executeWithRetry(() =>
        ai.models.generateContent({
          model: model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        })
      , 2, 2000); // 2000ms delay
      return response.text || '';
    } catch (error: any) {
      console.warn(`[FollowUp Analysis] Model ${model} failed. Trying fallback...`, error);
      lastError = error;
    }
  }

  // 모든 모델이 실패했을 때만 쿼터 초과 에러를 UI로 던짐
  console.error("FollowUp Analysis final error:", lastError);
  const isRateLimit = lastError?.status === 429 || lastError?.message?.toLowerCase().includes('quota');
  if (isRateLimit) {
    throw new Error("QUOTA_EXCEEDED");
  }
  throw lastError;
};
