import { GoogleGenAI, Type } from "@google/genai";
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
      "gemini-3.1-flash-lite"
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
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  chartContent: { type: Type.STRING },
                  diagnosticGuide: { type: Type.STRING },
                  matchProbability: { type: Type.STRING },
                  matchReason: { type: Type.STRING },
                  assessmentDisease: { type: Type.STRING },
                  treatmentRecommendation: { type: Type.STRING },
                  recommendedTreatmentType: { type: Type.STRING },
                  consultationFeedback: { type: Type.STRING }
                },
                required: ["chartContent", "diagnosticGuide", "treatmentRecommendation"]
              }
            }
          })
        );
        let rawText = response.text || '';
        if (!rawText) {
          throw new Error("Empty response from AI (possibly blocked by safety filters)");
        }
        rawText = rawText.trim();
        if (rawText.startsWith('```json')) {
          rawText = rawText.substring(7);
        } else if (rawText.startsWith('```')) {
          rawText = rawText.substring(3);
        }
        if (rawText.endsWith('```')) {
          rawText = rawText.substring(0, rawText.length - 3);
        }
        const parsed = JSON.parse(rawText.trim());
        if (!parsed.chartContent && !parsed.diagnosticGuide) {
          throw new Error("AI returned empty fields in JSON");
        }
        return parsed;
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
        const textResult = response.text || '';
        return await processWebhookResponse(textResult);
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


export const processWebhookResponse = async (text: string): Promise<string> => {
  let rawJson = null;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  
  if (codeBlockMatch) {
    rawJson = codeBlockMatch[1];
    text = text.replace(codeBlockMatch[0], '').trim();
  } else {
    // Robust balanced JSON extractor for fallback
    let firstBracket = text.indexOf('[');
    let firstBrace = text.indexOf('{');
    if (firstBracket !== -1 || firstBrace !== -1) {
      let isArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
      let openChar = isArray ? '[' : '{';
      let closeChar = isArray ? ']' : '}';
      let start = isArray ? firstBracket : firstBrace;
      
      let depth = 0;
      let inString = false;
      let escape = false;
      let extracted = null;
      
      for (let i = start; i < text.length; i++) {
        let char = text[i];
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (!inString) {
          if (char === openChar) depth++;
          else if (char === closeChar) {
            depth--;
            if (depth === 0) {
              extracted = text.substring(start, i + 1);
              break;
            }
          }
        }
      }
      if (extracted) {
        rawJson = extracted;
        text = text.replace(extracted, '').trim();
      }
    }
  }

  if (rawJson) {
    try {
      let parsedData = JSON.parse(rawJson);
      if (!Array.isArray(parsedData)) parsedData = [parsedData];
      
      const webhookUrl = 'https://script.google.com/macros/s/AKfycbzEetbOaAPEneei0sXqDaHfTeqMaliTKlayrLzVsstzsUtqe6ErJaneytTMqwcc375A/exec';
      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedData)
      });

      if (webhookRes.ok) {
        const responseText = await webhookRes.text();
        let webhookData;
        try {
          webhookData = JSON.parse(responseText);
        } catch(e) {
          webhookData = { error: "Invalid JSON from webhook" };
        }
        
        if (Array.isArray(webhookData) && webhookData.length > 0) {
           let hasAnyHerbs = false;
           webhookData.forEach((data: any, index: number) => {
              if (data.final_recipe && Object.keys(data.final_recipe).length > 0) {
                  hasAnyHerbs = true;
                  const recipeNames = parsedData[index] && parsedData[index]["합방_처방"] 
                                      ? parsedData[index]["합방_처방"].join(" + ") 
                                      : `추천 처방 ${index + 1}`;
                  let markdownList = `\n\n### 🌿 [${recipeNames}] 약재 용량 (1일 기준)\n`;
                  for (const [herb, amount] of Object.entries(data.final_recipe)) {
                    markdownList += `- **${herb}**: ${amount as number}g\n`;
                  }
                  text += markdownList;
              }
           });
           if (!hasAnyHerbs) {
             text += `\n\n> ⚠️ **안내:** 구글 시트에서 요청한 처방명(예: ${parsedData[0] && parsedData[0]["합방_처방"] ? parsedData[0]["합방_처방"].join(", ") : "처방"})을 찾지 못해 약재 목록을 구성할 수 없습니다. 시트의 '처방명' 열에 해당 처방이 띄어쓰기 없이 정확히 입력되어 있는지 확인해주세요.`;
           }
        } else if (webhookData?.final_recipe && Object.keys(webhookData.final_recipe).length > 0) {
          let markdownList = '\n\n### 🌿 추천 처방 약재 용량 (1일 기준)\n';
          for (const [herb, amount] of Object.entries(webhookData.final_recipe)) {
            markdownList += `- **${herb}**: ${amount as number}g\n`;
          }
          text += markdownList;
        } else if (webhookData?.error) {
          text += `\n\n> ⚠️ **구글 스크립트 오류:** ${webhookData.error}`;
        } else {
          text += `\n\n> ⚠️ **안내:** 구글 시트에서 해당 처방을 찾을 수 없습니다.`;
        }
      } else {
        text += `\n\n> ⚠️ 약재 용량 계산 서버와 통신할 수 없거나 형식이 올바르지 않습니다. (상태 코드: ${webhookRes.status})`;
      }
    } catch (e) {
      console.error("Failed to parse JSON or call webhook:", e);
      text += `\n\n> ⚠️ 내부 서버 오류: 약재 용량을 파싱할 수 없습니다.`;
    }
  }
  return text;
};
