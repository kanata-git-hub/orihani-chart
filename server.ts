import dotenv from 'dotenv';
dotenv.config();
import { requireUser } from './serverSecurity.ts';
import { FollowUpError, generateFollowUpResponse } from './followUpEngine.ts';
import { RecipeError, searchPrescriptionPatients, createPrescriptionRecipe } from './prescriptionRecipe.ts';
import type { SheetRows } from './prescriptionRecipe.ts';
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// AI Studio requires port 3000. Cloud Run provides PORT via env var (usually 8080).
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use('/api', requireUser);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// API Endpoints
const executeWithRetry = async (apiCall: () => Promise<any>, maxRetries = 3, baseDelayMs = 5000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error: any) {
      const errorMsg = error?.message?.toLowerCase() || '';
      const isRateLimit = error?.status === 429 || errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate limit');
      if (isRateLimit && i < maxRetries - 1) {
        const waitTime = baseDelayMs * (i + 1);
        console.warn(`[API Rate Limit] Retrying in ${waitTime / 1000}s... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Maximum retries exceeded");
};

app.post("/api/generate-chart", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key not configured on the server");

    const ai = new GoogleGenAI({ apiKey });
    const { prompt, audioData } = req.body;

    const contents: any[] = [{ text: prompt }];
    if (audioData) {
      contents.unshift({
        inlineData: { mimeType: audioData.mimeType, data: audioData.data }
      });
    }

    const models = ["gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
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
                  consultationFeedback: { type: Type.STRING },
                  herbsRecipe: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        합방_처방: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING }
                        },
                        가감_목록: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              약재명: { type: Type.STRING },
                              동작: { type: Type.STRING },
                              용량_g: { type: Type.NUMBER },
                              남길_비율: { type: Type.NUMBER }
                            }
                          }
                        }
                      }
                    }
                  }
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
        
        let parsed;
        const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlockMatch) {
          parsed = JSON.parse(codeBlockMatch[1].trim());
        } else {
          // Fallback robust extractor
          const firstBrace = rawText.indexOf('{');
          const lastBrace = rawText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            parsed = JSON.parse(rawText.substring(firstBrace, lastBrace + 1));
          } else {
            parsed = JSON.parse(rawText.trim());
          }
        }
        
        if (!parsed.chartContent && !parsed.diagnosticGuide) {
          throw new Error("AI returned empty fields in JSON");
        }
        return res.json(parsed);
      } catch (err: any) {
        console.warn(`Model ${model} failed. Trying next...`, err.message);
        lastError = err;
      }
    }
    throw lastError;
  } catch (error: any) {
    console.error("Generate chart error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-followup", async (req, res) => {
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', onClose);
  try {
    const generated = await generateFollowUpResponse(req.body?.prompt, req.body?.engine, { signal: controller.signal });
    let text = generated.text;

        // JSON 파싱 및 구글 스크립트 웹훅 연동 로직
        let rawJson = null;
        
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlockMatch) {
          rawJson = codeBlockMatch[1];
          // 원본 텍스트에서 JSON 부분을 완벽히 제거
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
            if (!Array.isArray(parsedData)) {
              parsedData = [parsedData];
            }
            
            
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
                console.error("Parse error on webhook response", e);
                webhookData = { error: "Invalid JSON from webhook" };
              }
              
              if (Array.isArray(webhookData) && webhookData.length > 0) {
                 let hasAnyHerbs = false;
                 webhookData.forEach((data, index) => {
                    if (data.final_recipe && Object.keys(data.final_recipe).length > 0) {
                        hasAnyHerbs = true;
                        // 처방명이 있는 경우 해당 처방명을 출력
                        const recipeNames = parsedData[index] && parsedData[index]["합방_처방"] 
                                            ? parsedData[index]["합방_처방"].join(" + ") 
                                            : `추천 처방 ${index + 1}`;
                                            
                        let markdownList = `\n\n### 🌿 [${recipeNames}] 약재 용량\n\n`;
                        
                        const daysList = [1, 7, 15, 30];
                        
                        for (const days of daysList) {
                          markdownList += `<details className="mb-2 bg-gray-50 p-2 rounded-md border border-gray-200 cursor-pointer">\n`;
                          markdownList += `<summary className="font-bold text-primary select-none">${days}일 기준 약재 총량</summary>\n\n`;
                          markdownList += `<div className="mt-2 pl-4 grid grid-cols-2 sm:grid-cols-3 gap-2">\n`;
                          for (const [herb, amount] of Object.entries(data.final_recipe)) {
                            const formatAmt = (amt: number, multiplier: number) => {
                              let str = String(amt * multiplier);
                              let dotIndex = str.indexOf('.');
                              if (dotIndex !== -1) {
                                let decimals = str.substring(dotIndex + 1);
                                if (decimals.length > 2) {
                                  str = str.substring(0, dotIndex + 3);
                                }
                              }
                              return Number(str) + 'g';
                            };
                            
                            const baseAmt = amount as number;
                            markdownList += `  <div className="flex justify-between items-center bg-white p-1.5 rounded shadow-sm text-sm border border-gray-100">
    <span className="font-medium text-gray-700">${herb}</span>
    <span className="text-gray-900">${formatAmt(baseAmt, days)}</span>
  </div>\n`;
                          }
                          markdownList += `</div>\n</details>\n`;
                        }
                        
                        text += markdownList;
                    }
                 });
                 if (!hasAnyHerbs) {
                   text += `\n\n> ⚠️ **안내:** 구글 시트에서 요청한 처방명(예: ${parsedData[0] && parsedData[0]["합방_처방"] ? parsedData[0]["합방_처방"].join(", ") : "처방"})을 찾지 못해 약재 목록을 구성할 수 없습니다. 시트의 '처방명' 열에 해당 처방이 띄어쓰기 없이 정확히 입력되어 있는지 확인해주세요.`;
                 }
              } else if (webhookData.final_recipe && Object.keys(webhookData.final_recipe).length > 0) {
                let markdownList = '\n\n### 🌿 추천 처방 약재 용량\n\n';
                
                const daysList = [1, 7, 15, 30];
                
                for (const days of daysList) {
                  markdownList += `<details className="mb-2 bg-gray-50 p-2 rounded-md border border-gray-200 cursor-pointer">\n`;
                  markdownList += `<summary className="font-bold text-primary select-none">${days}일 기준 약재 총량</summary>\n\n`;
                  markdownList += `<div className="mt-2 pl-4 grid grid-cols-2 sm:grid-cols-3 gap-2">\n`;
                  for (const [herb, amount] of Object.entries(webhookData.final_recipe)) {
                    const formatAmt = (amt: number, multiplier: number) => {
                      let str = String(amt * multiplier);
                      let dotIndex = str.indexOf('.');
                      if (dotIndex !== -1) {
                        let decimals = str.substring(dotIndex + 1);
                        if (decimals.length > 2) {
                          str = str.substring(0, dotIndex + 3);
                        }
                      }
                      return Number(str) + 'g';
                    };
                    
                    const baseAmt = amount as number;
                    markdownList += `  <div className="flex justify-between items-center bg-white p-1.5 rounded shadow-sm text-sm border border-gray-100">
    <span className="font-medium text-gray-700">${herb}</span>
    <span className="text-gray-900">${formatAmt(baseAmt, days)}</span>
  </div>\n`;
                  }
                  markdownList += `</div>\n</details>\n`;
                }
                
                text += markdownList;
              } else if (webhookData.error) {
                text += `\n\n> ⚠️ **구글 스크립트 오류:** ${webhookData.error}`;
              } else {
                text += `\n\n> ⚠️ **안내:** 구글 시트에서 해당 처방을 찾을 수 없습니다.`;
              }
            } else {
              console.warn("Webhook returned error status:", webhookRes.status);
              text += `\n\n> ⚠️ 약재 용량 계산 서버와 통신할 수 없거나 형식이 올바르지 않습니다. (상태 코드: ${webhookRes.status})`;
            }
          } catch (e) {
            console.error("Failed to parse JSON or call webhook:", e);
            text += `\n\n> ⚠️ 내부 서버 오류: 약재 용량을 파싱할 수 없습니다.`;
          }
        }

    return res.json({ text, engine: generated.engine, model: generated.model });
  } catch (error: any) {
    const code = error instanceof FollowUpError ? error.message : 'ANALYSIS_FAILED';
    console.error('Followup error:', code);
    if (!res.destroyed) res.status(error instanceof FollowUpError ? error.status : 500).json({ error: code });
  } finally {
    res.off('close', onClose);
  }
});

app.post("/api/proxy-webhook", async (req, res) => {
  try {
    const webhookUrl = 'https://script.google.com/macros/s/AKfycbzEetbOaAPEneei0sXqDaHfTeqMaliTKlayrLzVsstzsUtqe6ErJaneytTMqwcc375A/exec';
    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const responseText = await webhookRes.text();
    res.status(webhookRes.status).send(responseText);
  } catch (error: any) {
    console.error("Webhook proxy error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/fetch-google-sheet", async (req, res) => {
  const { accessToken, name, gender, symptoms } = req.body;
  
  if (!accessToken) {
    return res.status(401).json({ error: "Google Access Token is required. Please re-login." });
  }

  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const sheets = google.sheets({ version: 'v4', auth });
    
    const spreadsheetId = '1Nz9rBTwGYog-HEPPUyX5YsNnKvWBW5B9E7LADKMVZ48';
    const range = '한약환자!A1:U';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No data found in the sheet.' });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    const nameIndex = headers.indexOf('성함');
    const genderIndex = headers.indexOf('성별');
    const symptomsIndex = headers.indexOf('증상');

    const matches = dataRows.filter((row: any[]) => {
      const rowName = row[nameIndex] || '';
      const rowGender = row[genderIndex] || '';
      const rowSymptoms = row[symptomsIndex] || '';

      const nameMatch = rowName.trim() === name?.trim();
      const genderMatch = rowGender.trim() === gender?.trim();
      const symptomsMatch = symptoms ? rowSymptoms.includes(symptoms.trim()) : true; 
      
      return nameMatch && genderMatch && symptomsMatch;
    });

    const results = matches.map((row: any[]) => {
      const obj: Record<string, string> = {};
      headers.forEach((header: string, index: number) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    return res.json({ matches: results });
  } catch (error: any) {
    console.error('Google Sheets API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Read-only recipe lookup. Use the signed-in user's Google token, never an AI response.
const prescriptionSpreadsheetId = '1Nz9rBTwGYog-HEPPUyX5YsNnKvWBW5B9E7LADKMVZ48';
async function readPrescriptionSheet(accessToken: string, range: string): Promise<SheetRows> {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${prescriptionSpreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401) throw new RecipeError('Google 연동이 만료되었습니다. Google 계정을 다시 연결해주세요.', 401);
  if (response.status === 403) throw new RecipeError('연결한 Google 계정에 한약환자관리 시트를 읽을 권한이 없습니다.', 403);
  if (!response.ok) throw new RecipeError('구글 시트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 502);
  const data = await response.json();
  if (!Array.isArray(data.values)) throw new RecipeError('구글 시트에 읽을 수 있는 데이터가 없습니다.');
  return data.values;
}

function recipeToken(body: any): string {
  if (typeof body?.accessToken !== 'string' || !body.accessToken.trim()) {
    throw new RecipeError('Google 계정을 연결해주세요.', 401);
  }
  if (body.accessToken.length > 10000 || /[\r\n]/.test(body.accessToken)) throw new RecipeError('Google 연동 정보를 확인해주세요.', 401);
  return body.accessToken;
}

function recipeErrorResponse(error: unknown, res: express.Response) {
  if (error instanceof RecipeError) return res.status(error.status).json({ error: error.message });
  // Do not log upstream request objects: they contain the Google access token.
  return res.status(502).json({ error: '처방 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
}

app.post('/api/prescription-patients', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const token = recipeToken(req.body);
    const { name, gender = '', symptoms = '' } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof gender !== 'string' || gender.length > 20 || typeof symptoms !== 'string' || symptoms.length > 500) {
      throw new RecipeError('환자 이름과 검색 조건을 확인해주세요.', 400);
    }
    const rows = await readPrescriptionSheet(token, "'한약환자'!A1:V");
    const patients = searchPrescriptionPatients(rows, { name, gender, symptoms });
    return res.json({ patients, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return recipeErrorResponse(error, res);
  }
});

app.post('/api/prescription-recipe', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const token = recipeToken(req.body);
    const { patientId } = req.body;
    if (typeof patientId !== 'string' || patientId.length > 120 || !/^(?:chart:.+|row:[1-9]\d*:[a-f0-9]{16})$/.test(patientId)) {
      throw new RecipeError('검색 결과에서 환자를 선택해주세요.', 400);
    }
    const [patients, herbs] = await Promise.all([
      readPrescriptionSheet(token, "'한약환자'!A1:V"),
      readPrescriptionSheet(token, "'약재'!A1:D"),
    ]);
    const recipe = createPrescriptionRecipe(patients, herbs, patientId);
    return res.json({ ...recipe, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return recipeErrorResponse(error, res);
  }
});

// Vite Development Middleware or Static Files
if (process.env.NODE_ENV !== "production") {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
  
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Dev Server running on http://localhost:${PORT}`);
  });
} else {
  // Production
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Production Server running on http://0.0.0.0:${PORT}`);
  });
}
