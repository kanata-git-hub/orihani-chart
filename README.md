<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b2c282bc-7bca-4b2d-91b0-5a1e4c383e0a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Prescription re-evaluation engines

The re-evaluation room defaults to Gemini and also offers GPT Astra (`gpt-6-astra`).
Both providers receive the same existing prompt and share the prescription/herb
post-processing. The selected engine is saved with each patient's local draft;
results show the provider and actual model returned by the server. A failed run
keeps the previous result. Astra never silently falls back to Gemini.

Configure `OPENAI_API_KEY` in the runtime environment of each deployed Cloud Run
service that runs this app. It is server-only; do not place it in browser code or
a `VITE_` variable. Existing `GEMINI_API_KEY` configuration is unchanged. A missing
OpenAI key produces an actionable error and does not affect Gemini.

Astra uses the Responses API with `store: false`, medium reasoning and a 240-second
request timeout. Run `npm run test:followup`, `npm run test:security`,
`npm run lint`, and `npm run build` to validate changes. Tests use synthetic data
and mocked external services; they do not verify a live API key or model access.
