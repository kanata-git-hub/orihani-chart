import { authFetch } from '../authFetch';
import { PatientBriefing, AnalysisResult } from "../types";
import { generateChartPrompt } from "./prompts";

export const generateAIChart = async (
  briefing: PatientBriefing,
  audioData?: { mimeType: string; data: string }
): Promise<AnalysisResult> => {
  const prompt = generateChartPrompt(briefing);

    console.log("[Server Mode] 배포 환경: 백엔드 API를 통해 생성");
    const response = await authFetch('/api/generate-chart', {
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

    const parsed = await response.json();
    if (parsed.herbsRecipe && Array.isArray(parsed.herbsRecipe) && parsed.herbsRecipe.length > 0) {
      parsed.herbAmountsHtml = await fetchHerbAmountsHtml(parsed.herbsRecipe);
    }
    return parsed;
};

export const generateFollowUpAnalysis = async (
  prompt: string
): Promise<string> => {
    const response = await authFetch('/api/generate-followup', {
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
};


export const fetchHerbAmountsHtml = async (parsedData: any[]): Promise<string> => {
  let html = '';
  try {
    const webhookUrl = '/api/proxy-webhook';
    const webhookRes = await authFetch(webhookUrl, {
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
                
                html += markdownList;
            }
         });
         if (!hasAnyHerbs) {
           html += `\n\n> ⚠️ **안내:** 구글 시트에서 요청한 처방명(예: ${parsedData[0] && parsedData[0]["합방_처방"] ? parsedData[0]["합방_처방"].join(", ") : "처방"})을 찾지 못해 약재 목록을 구성할 수 없습니다. 시트의 '처방명' 열에 해당 처방이 띄어쓰기 없이 정확히 입력되어 있는지 확인해주세요.`;
         }
      } else if (webhookData?.final_recipe && Object.keys(webhookData.final_recipe).length > 0) {
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
        
        html += markdownList;
      } else if (webhookData?.error) {
        html += `\n\n> ⚠️ **구글 스크립트 오류:** ${webhookData.error}`;
      } else {
        html += `\n\n> ⚠️ **안내:** 구글 시트에서 해당 처방을 찾을 수 없습니다.`;
      }
    } else {
      html += `\n\n> ⚠️ 약재 용량 계산 서버와 통신할 수 없거나 형식이 올바르지 않습니다. (상태 코드: ${webhookRes.status})`;
    }
  } catch (e) {
    console.error("Failed to parse JSON or call webhook:", e);
    html += `\n\n> ⚠️ 내부 서버 오류: 약재 용량을 가져올 수 없습니다.`;
  }
  return html;
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
      const html = await fetchHerbAmountsHtml(parsedData);
      text += html;
    } catch (e) {
      console.error("Failed to parse JSON:", e);
      text += `\n\n> ⚠️ 내부 서버 오류: JSON을 파싱할 수 없습니다.`;
    }
  }
  return text;
};
