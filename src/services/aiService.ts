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

  const response = await fetch('/api/generate-chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, audioData })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server responded with ${response.status}`);
  }

  return response.json();
};

export const generateFollowUpAnalysis = async (
  prompt: string
): Promise<string> => {
  const response = await fetch('/api/generate-followup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("QUOTA_EXCEEDED");
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server responded with ${response.status}`);
  }

  const data = await response.json();
  return data.text;
};
