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

  // AI Studio 환경(미리보기)에서는 process.env.GEMINI_API_KEY가 주입됩니다.
  // Cloud Run 배포 빌드 시에는 이 값이 undefined로 치환되어 서버를 호출하게 됩니다.
  const clientApiKey = process.env.GEMINI_API_KEY;

  if (clientApiKey) {
    console.log("[Client Mode] AI Studio 환경: 클라이언트에서 직접 생성");
    const ai = new GoogleGenAI({ apiKey: clientApiKey });
    
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
        let rawText = response.text || '{}';
        rawText = rawText.trim();
        if (rawText.startsWith('```json')) {
          rawText = rawText.substring(7);
        } else if (rawText.startsWith('```')) {
          rawText = rawText.substring(3);
        }
        if (rawText.endsWith('```')) {
          rawText = rawText.substring(0, rawText.length - 3);
        }
        return JSON.parse(rawText.trim());
      } catch (err) {
        console.warn(`Model ${model} failed. Trying next...`, err);
        lastError = err;
      }
    }
    throw lastError;

  } else {
    console.log("[Server Mode] 배포 환경: 백엔드 API를 통해 생성");
    const response = await fetch('/api/generate-chart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        audioData
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    return response.json();
  }
};

export const generateFollowUpAnalysis = async (
  prompt: string
): Promise<string> => {
  const clientApiKey = process.env.GEMINI_API_KEY;

  if (clientApiKey) {
    const ai = new GoogleGenAI({ apiKey: clientApiKey });
    const models = [
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview"
    ];

    let lastError: any;
    for (const model of models) {
      try {
        const response = await executeWithRetry(() =>
          ai.models.generateContent({
            model: model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          })
        , 2, 2000);
        return response.text || '';
      } catch (error: any) {
        console.warn(`[FollowUp Analysis] Model ${model} failed. Trying fallback...`, error);
        lastError = error;
      }
    }

    console.error("FollowUp Analysis final error:", lastError);
    const isRateLimit = lastError?.status === 429 || lastError?.message?.toLowerCase().includes('quota');
    if (isRateLimit) {
      throw new Error("QUOTA_EXCEEDED");
    }
    throw lastError;

  } else {
    const response = await fetch('/api/generate-followup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("QUOTA_EXCEEDED");
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const data = await response.json();
    return data.text;
  }
};

