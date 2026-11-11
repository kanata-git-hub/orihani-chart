# OpenAI migration decision ledger — Ori Chart

Status: comparison-only short-instruction revision authorized 2026-11-11. Prior live outputs did not meet the user’s decision/tone criteria; production remains Gemini.
Base: `kanata-git-hub/orihani-chart` at `05b2fdbad9b56e4935e625cde45e93ede70ac2af`.
Implementation authorized 2026-11-11 (Asia/Seoul), using the existing server-side key. No new key created. The user has run four live comparisons in their authenticated Cloud Shell. The development environment still has no server credentials and has not itself made live API calls.

## Approved scope and stages

1. Ori Chart: initial chart (text + audio) and prescription re-evaluation, same existing tone/instructions, side-by-side actual output comparison before changing the default. The comparison branch has the initial OpenAI route and a reproducible synthetic comparison runner; the current change adds only the approved short OpenAI directive. Existing re-evaluation already has Astra.
2. Stop after Ori Chart. Do not start another app without further user instruction. No other repository is modified.
3. The target is equal or better outputs, not just successful API requests. Default remains Gemini pending that condition. A draft PR preserves the concrete implementation while live access is blocked.

Credential decision: use the existing server-only `OPENAI_API_KEY` configured for Ori Chart. No credential value is stored in this repository.

## Application and integration assessment

| Workflow | Existing | Added or retained route | Validation |
|---|---|---|---|
| Initial chart, text | Gemini Pro → Flash → Flash Lite, buffered JSON | Add direct Responses API / gpt-6-astra, medium; preserve Gemini default and fallback ladder | chart unit + actual Express endpoint tests with mocked external services |
| Initial chart, consultation audio | Original audio to Gemini | gpt-transcribe multipart → unabridged transcript in separate input content → Astra | audio format/size/errors tested; acoustic/word/speaker quality pending live comparison |
| Prescription re-evaluation | Both Gemini and Astra, same prompt and shared herb processing | Existing direct Responses integration plus approved short directive; model/settings retained | existing follow-up unit, HTTP and client suite |
| Prescription recipes | Deterministic Google Sheets computation | No AI migration needed | existing recipe suite |
| Quality comparison | None | Sequential provider calls, frozen same prompt/audio, actual model, duration, JSON + escaped HTML | synthetic tests and four live reports reviewed; new directive’s live outputs pending |

Direct integration reuses the existing architecture and keeps credentials server-side. Gemini remains available for baseline/rollback; the OpenAI route never automatically sends a failed request to Gemini. No new agent framework, tools, retained conversation store, or user-visible reasoning stream is introduced.

## Capability review

Every heading in the migration guidance was reviewed. `Implemented` below means local behavior verified, not live quality approval.

| Guidance heading | Applicability / support | Decision and evidence |
|---|---|---|
| Model Selection | Yes / yes | Preserve existing gpt-6-astra; same medium reasoning as re-evaluation. Add current gpt-transcribe for files because Astra has no audio input. Account entitlement unknown. |
| Instruction File Naming | No | No existing instruction files renamed; no AGENTS.md added. |
| Migrate from Chat Completions to Responses | Yes / yes | Existing direct Responses route reused conceptually for initial charts. No Chat Completions paths exist. |
| Streaming | No benefit for current contract | Retain complete JSON / complete re-evaluation response. UI and herb parsing require complete output. |
| WebSocket Mode | Not applicable | Independent one-shot HTTP tasks; no tool loops or multiplexed connections. |
| Data Privacy — Zero Data Retention | Applicable / account unknown | Preserve store:false, no patient/audio/key logging, no new provider storage. store:false is not a claim of ZDR. |
| Data Privacy — Data Residency | Account unknown | Preserve existing OpenAI endpoint. No residency requirement was supplied or inferred; project configuration not accessible. |
| Processing Tiers | Yes / standard | Preserve standard, synchronous interactive requests and standard comparison calls; no Priority/Flex/Batch/Reserved. User values quality and avoiding extra spend. |
| Prompt Caching | Limited | Default implicit behavior retained. Original prompt embeds patient data before most reusable instructions; no reorder during tone-preservation baseline. |
| Prompt Cache Keys | Not needed | No new keys for GPT-6. |
| Extended Cache Retention | Not applicable | No older-model extended retention or new retained state. |
| Explicit Cache Breakpoints | Limited benefit | Existing monolithic prompt has variable patient content near beginning; no useful full-prefix boundary without changing original prompt structure. |
| Prompt Cache Diagnostics | No comparison ID available | One-shot store:false flows return no response ID to caller; no retained conversation added solely for diagnostics. |
| State Management | Existing one-shot | Each run sends full original prompt. Account-scoped browser draft/result persistence retained. |
| Instruction Persistence Gotcha | Already satisfied | Full instructions supplied every call; no previous_response_id. |
| Encrypted Reasoning Items | Not applicable | No API conversation replay/tool continuation. |
| Reasoning Effort | Yes / yes | Explicit medium, consistent with existing Astra route. |
| Reasoning Preservation | Not applicable | One-shot prompts; no multi-turn API reasoning state. |
| Reasoning Summaries / Tool Preambles | Not applicable | Preserve final-output-only UI; no tools. |
| Verbosity | Yes / yes | Explicit medium for added chart route, same documented default; tone/length still defined by original prompt. Existing re-evaluation unchanged. |
| Maximum Output Tokens | Yes | Reuse 16384-token budget and 240s timeout from current Astra integration; incomplete output is rejected. |
| Assistant Message Phases | Not applicable | No replayed assistant messages or intermediate phase display. |
| Context Compaction | Not applicable | No accumulating API conversation or tool loop. |
| Structured Outputs | Yes / yes | Initial chart uses strict text.format JSON schema. Required recipe numeric slots allow null; remove nulls before existing recipe processing. Re-evaluation remains free text plus its original JSON block. |
| Tools — Tool Choice | Not applicable | No model-controlled tools; existing recipe webhook remains deterministic post-processing. |
| Tool Search / Additional Tools | Not applicable | No tool catalog. |
| Parallel Tool Calls | Not applicable | No model tool execution; comparisons deliberately sequential. |
| Programmatic Tool Calling | Not applicable | No code-execution tool workflow. |
| Model-Aligned Tool Interfaces | Not applicable | No tool redesign in this migration. |

Provider guidance: raw fetch to api.openai.com, no proxy/framework compatibility limitations. Gemini request schema and ladder retained; OpenAI uses its own text.format schema and no Gemini-specific settings. ASTRA audio requires a distinct transcription endpoint. The shared prompt factory preserves the original baseline except the previously approved Chuna line. This revision does not change it. Both OpenAI paths add the same exact short directive using Responses instructions; no model or reasoning setting changes.

## Comparison and rollout gate

Seven synthetic text cases cover musculoskeletal charting, digestive tolerability, accident-specific restrictions, improvement, plateau/partial response, and prescription constraints. An eighth synthetic recorded dialogue is optional in the runner and mandatory for full audio signoff. Reports always leave clinical equivalence not established until reviewed. Missing live outputs must not be replaced with fabricated comparisons or mock scores.

Required before switching defaults: actual key/model access; identical-input baseline/candidate outputs; tone, clinical settings, missing/invented facts, formula JSON and herb post-processing review; recorded-dialogue word/number/negation/speaker preservation; latency/error review; deployed artifact and authenticated UI checks. User's broader migration authorization persists, but their equal-or-better condition has not yet been demonstrated.

## Current short-instruction experiment

Latest revision, authorized 2026-11-11: replace the adherence paragraph with a concise reasoning task grounded in supplied patient information and the clinician’s given premises. Output the most promising candidate, rationale and maintenance/change first; do not make extra questioning, search, or reconfirmation of already specified compounding a prerequisite. Inference remains distinct from fact, and patient-specific contraindications and red flags remain relevant. Shared prompts, model/settings, provider paths and baseline stay unchanged. Fourth actual report (evaluator 837d3eeead402562e2c8a6dea8dff179f60f136b) completed seven new Astra runs but still omitted the traffic-injury formula and added compounding reconfirmation. The new instruction has not had live outputs reviewed.

User asked whether the short paragraph was appropriate and explicitly authorized editing and comparison. Its exact wording is stored in `openaiClinicalInstructions.ts`. Prior broad instruction changes are not restored. Latest Gemini baseline: `bcd998055187bbfd4dc223e14dbaa10b09ebf510`, generated 2026-11-11T04:18:31.151Z, seven completed Gemini outputs. The helper reuses only these matching-input Gemini runs and requests seven fresh Astra outputs. Report provenance distinguishes the extra OpenAI instruction and old baseline. Prior Astra checkpoints cannot become fresh results. No production deployment or default switch is part of this experiment.

## Validation evidence

Current reasoning revision: TypeScript and all 56 engine/client/HTTP/comparison checks passed. The retired-instruction regression uses the exact preceding paragraph. The actual downloaded latest report passed a no-key/no-call dry run with zero Gemini and seven Astra requests pending. Independent review confirmed shared prompt file is byte-identical and each engine changes only its new import and instructions property. All 56 engine, client, HTTP and comparison checks passed after updating the HTTP mocks to require the exact approved instruction. Final Linux CI is pending. New live model results remain pending.

Earlier migration validation:

Passed: TypeScript, build, 104 automated tests (security 12, re-evaluation 10, recipe 51, chart 24, comparison 7), comparison dry-run, client-key build sentinel scan, npm audit (0 vulnerabilities), and diff whitespace checks. Firestore emulator tests could not start: ECONNREFUSED 127.0.0.1:8085; Firestore code/rules were not modified. Unit/HTTP tests use synthetic data and fake provider responses. Real API, credit charging and production deployment are not verified. No other app is started while this first-app gate remains open.

## Official sources checked 2026-11-11

- https://developers.openai.com/api/docs/guides/chatgpt-api-credits — subscription API benefit must link to an owned org; use that org's project key.
- https://developers.openai.com/api/docs/models/gpt-6-astra — text/image, no audio, medium reasoning supported.
- https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra — migration and current model parameters.
- https://developers.openai.com/api/docs/guides/structured-outputs — strict JSON schema.
- https://developers.openai.com/api/docs/guides/speech-to-text — current gpt-transcribe file route, languages[], 25MB.
- https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create — file formats including Ogg and FLAC.
