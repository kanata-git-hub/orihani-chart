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

## Prescription recipe lookup

The separate **처방 레시피** tab searches the connected patient sheet by name,
with optional gender and symptom filters. Select a patient after checking their
chart number, age, symptoms and latest record date. Records are grouped by chart
number; a historical symptom match still opens that patient's newest record.
Payment date takes precedence, with delivery date and sheet row as fallbacks.

Each recipe request reads the latest patient row and the current herb catalog
again. Formula duplicates use the larger daily amount. The daily, 7-, 15- and
30-day herb panels start collapsed, with their total grams visible. Unknown formulas, missing quantities or
ambiguous modifications produce an error instead of an incomplete recipe. This
read-only lookup does not call an AI provider or write patient data to the sheet.
The compact herb grid uses three columns on phones and up to eight on desktops.
Herb names are bold, and each displayed gram amount has a colored background badge.
The nine dose bands end at 15, 30, 45, 60, 75, 90, 120 and 150g, with a final band
above 150g. Colors use the displayed daily or course amount, rounded to six decimals.
Searches, selected recipes and expanded day panels are saved in the browser per
signed-in account. Refreshing or switching menus restores the previous view;
restored recipes show their lookup timestamp and can be refreshed from the sheet.
The recipe tab's clear button removes its saved state.
Parenthesized `마황(5g)` and `마황 고용량(2.5g)` modifiers in either 가 or 감
specify the final amount per pack. Two packs per day give 10g/day and 5g/day,
respectively; this replaces any base ephedra amount before multiplying by days.
The high-dose label uses the same ephedra ingredient identity to avoid duplicates.
Other additions use explicit daily grams. An addition without a quantity stops
calculation; a bare removal excludes the whole herb, while `N/D` retains that ratio.
Run `npm run test:recipe` for calculation and HTTP regression checks.

Configure `OPENAI_API_KEY` in the runtime environment of each deployed Cloud Run
service that runs this app. It is server-only; do not place it in browser code or
a `VITE_` variable. Existing `GEMINI_API_KEY` configuration is unchanged. A missing
OpenAI key produces an actionable error and does not affect Gemini.

Astra uses the Responses API with `store: false`, medium reasoning and a 240-second
request timeout. Run `npm run test:followup`, `npm run test:security`,
`npm run lint`, and `npm run build` to validate changes. Tests use synthetic data
and mocked external services; they do not verify a live API key or model access.
