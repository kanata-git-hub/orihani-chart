import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// AI Studio requires port 3000. Cloud Run provides PORT via env var (usually 8080).
const PORT = process.env.PORT || 3000;

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

    const models = ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"];
    let lastError: any;

    for (const model of models) {
      try {
        const response = await executeWithRetry(() =>
          ai.models.generateContent({
            model: model,
            contents: [{ parts: contents }],
            config: { responseMimeType: "application/json" }
          })
        );
        return res.json(JSON.parse(response.text || '{}'));
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
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key not configured on the server");

    const ai = new GoogleGenAI({ apiKey });
    const { prompt } = req.body;

    const models = ["gemini-3.1-pro-preview", "gemini-3-flash-preview"];
    let lastError: any;

    for (const model of models) {
      try {
        const response = await executeWithRetry(() =>
          ai.models.generateContent({
            model: model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          }), 2, 2000
        );
        return res.json({ text: response.text || '' });
      } catch (error: any) {
        console.warn(`FollowUp Analysis Model ${model} failed...`, error.message);
        lastError = error;
      }
    }
    const isRateLimit = lastError?.status === 429 || lastError?.message?.toLowerCase().includes('quota');
    if (isRateLimit) return res.status(429).json({ error: "QUOTA_EXCEEDED" });
    throw lastError;
  } catch (error: any) {
    console.error("Followup error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Vite Development Middleware or Static Files
if (process.env.NODE_ENV !== "production") {
  import("vite").then(async ({ createServer }) => {
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Dev Server running on http://localhost:${PORT}`);
    });
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
