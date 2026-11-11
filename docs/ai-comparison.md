# 오리차트 Gemini / OpenAI 결과 비교

> **현재 재검증:** 사용자의 추나 검토 범위 확대 및 추가 이득에 따른 병행 치료 원칙을 공통 프롬프트에 반영했습니다. 이번에는 `python3 scripts/cloud-shell-compare.py`로 Gemini 7건과 OpenAI 7건을 새로 비교합니다. 이전 `--reuse-gemini` 결과는 입력 해시가 달라 사용할 수 없으며, 검증기가 요청 전에 중단합니다. 아래 재사용 안내는 입력이 동일한 평가 사이에만 적용됩니다.

이 도구는 **한 앱의 실제 결과 비교**를 위한 개발 도구입니다. 기본 입력 7개는 모두 새로 만든 합성 사례이며 환자 시트·브라우저 저장소·기존 진료 기록을 읽지 않습니다. 실제 API 요청은 명시적으로 live 명령을 실행할 때만 발생합니다.

`src/services/prompts.ts`의 기존 함수를 직접 불러와 한 번 만든 프롬프트를 두 엔진에 **동일한 문자열**로 전달합니다. OpenAI에는 별도의 원내 조제·문체 지시도 전달하며, 보고서에 그 원문과 SHA-256을 기록합니다. 따라서 두 공급자의 전체 유효 프롬프트가 같다고 표시하지 않습니다. 재평가는 `generateFollowUpResponse`, 초진은 `generateChartResponse`를 호출합니다. Gemini 다음 Astra 순서로 한 요청씩 실행합니다. 실제 fallback 모델은 반환된 `model`로 확인합니다.

## 유료 호출 없이 점검

```sh
npm ci --ignore-scripts
node --experimental-strip-types scripts/compare-ai.ts --dry-run
node --experimental-strip-types --test tests/ai-comparison.test.ts
```

Dry run은 사례 이름·종류·프롬프트 SHA-256·길이만 출력하며 키를 요구하지 않고 네트워크로 모델을 호출하지 않습니다. 기존 프롬프트 파일의 확장자 없는 TypeScript import를 변경하지 않기 위해 설치된 `tsx`로 프롬프트 모듈을 불러옵니다.

## 실제 동일 입력 비교

### 기존 Cloud Run 키로 Cloud Shell에서 실행

`scripts/cloud-shell-compare.py`는 현재 Google Cloud 프로젝트의 `orihani-chart` 서비스를 확인하고, 기존 `OPENAI_API_KEY`와 `GEMINI_API_KEY`를 비교 프로세스에만 전달합니다. 일반 환경 변수와 Secret Manager 참조를 지원합니다. 키 값과 Cloud Run 전체 설정은 터미널이나 결과 ZIP에 넣지 않습니다. 서비스가 없거나 대상이 불명확하면 멈추며, 다른 앱으로 대체하지 않습니다.

```sh
python3 scripts/cloud-shell-compare.py
```

기본 실행은 유료 API를 사용하는 합성 텍스트 비교 7건(각 엔진 1회씩, Gemini 재시도 제외)을 수행합니다. Node.js 22.6 이상과 로그인된 gcloud가 필요합니다. 설치와 비교는 임시 작업 디렉터리에서 진행하고, 비교 코드 버전은 스크립트에 고정된 커밋으로 검증합니다. Cloud Run 배포·설정 변경은 실행하지 않습니다. 결과 ZIP을 내려받은 뒤 `comparison.html`을 직접 열거나 `comparison.json`을 검토자에게 전달할 수 있습니다. 이 텍스트 실행에는 음성 검증이 포함되지 않습니다.

Cloud Shell 실행은 각 요청이 끝날 때 결과를 `~/orihani-ai-comparison/<프로젝트>/<리전>/<비교 코드 커밋>/`에 저장합니다. `[1/14]`부터 `[14/14]`까지 사례와 엔진의 진행 상태를 표시합니다. 같은 명령을 다시 실행하면 저장된 성공 결과를 재사용하고, 실패했거나 결과가 저장되지 않은 요청만 다시 호출합니다. Ctrl+C로 중단해도 이 폴더는 남으며, 동일한 비교의 동시 실행은 차단합니다. 이전 버전처럼 임시 폴더에만 저장하다 중단된 결과를 복구하지는 못합니다.

실행 환경에 `OPENAI_API_KEY`와 `GEMINI_API_KEY`가 있어야 합니다. 키를 명령행 인수나 저장소에 넣지 마세요. OpenAI 크레딧을 연결한 API 조직과 키의 소속이 일치하는지 먼저 확인합니다. 이 도구는 크레딧 잔액을 확인하거나 유료 과금을 차단하지 않습니다.

```sh
node --experimental-strip-types scripts/compare-ai.ts --case followup-plateau
node --experimental-strip-types scripts/compare-ai.ts
node --experimental-strip-types scripts/compare-ai.ts --out generated/ai-comparison/review-01
```

`--case`는 여러 번 지정할 수 있습니다. 기본 출력 경로는 `generated/ai-comparison/<실행 시각>/`입니다. 이 경로는 Git에서 제외해야 합니다. 각 실행은 `comparison.json`과 `comparison.html`을 만듭니다. HTML은 외부 라이브러리 없이 열 수 있고 모든 모델 출력과 프롬프트를 HTML escape합니다. JSON은 앱 엔진 함수가 반환한 원문 결과·실제 모델·시간·프롬프트 해시·실패 코드를 보존합니다. upstream HTTP 전체 응답이나 토큰 사용량은 엔진 반환값에 없으므로 기록하지 않습니다.

중단 후 재개하려면 동일한 `--out` 경로와 `--resume`을 지정합니다. 기존 사례·프롬프트·음성 해시와 엔진 결과를 확인한 뒤 성공 결과만 재사용합니다. Cloud Shell 실행은 비교 코드 커밋도 일치해야 합니다. 설정이나 저장 형식이 일치하지 않으면 기존 파일을 덮어쓰지 않고 중단합니다.

한쪽 실패도 기록한 뒤 다른 쪽을 실행합니다. 실패 메시지와 stack은 그대로 저장하지 않고 제한된 오류 코드로 기록합니다. 한 요청이라도 실패하면 종료 코드는 1입니다. 이 성공/실패는 실행 결과이며 품질 합격 판정이 아닙니다.

## 사례와 검토 포인트

| 사례 | 입력의 차이 | 핵심 확인 |
|---|---|---|
| `chart-mild-pain` | 경도 통증·호전·정상 검사 | 좌우·기간·수치 보존, 불필요한 반복 문진 방지 |
| `chart-traffic-injury` | 교통사고·ROM 수치 | 도침 제한, 좌우 ROM 정확성 |
| `chart-digestion` | 소화기 내약성과 과거 복용 반응 | 구체적 한약 제안, 내약성 반영, JSON 일치 |
| `followup-improving` | 주 증상의 충분한 호전 | 유지도 유효한 선택, 무의미한 추가 방지 |
| `followup-plateau` | 소화는 호전·주 증상은 정체 | 주·동반 증상 분리, 다음 전략·변경 이유 |
| `followup-modifiers` | 최대량 합방·감초 제외·처방 1/2 | 중복 약재 합산 금지, 제외와 감량 구분 |
| `followup-constraints` | 확인된 알레르기·재고·내약성 | 금기 반영, 미확인 조제 가능성·효능 생성 금지 |
| `chart-audio` | 별도로 넣은 합성 음성 | 숫자·부정 표현·화자·대화 피드백 보존 |

## 합성 음성 비교

텍스트 평가만으로 전체 마이그레이션을 완료 판정하지 않습니다. 초진은 원본 음성을 직접 읽던 기능이므로 음성 비교가 필수입니다. 아래 대본을 녹음하거나 별도 승인된 음성 생성 과정에서 만든 파일만 입력하세요. 실제 진료 녹음을 자동으로 찾거나 사용하지 않습니다.

```sh
node --experimental-strip-types scripts/compare-ai.ts --print-audio-script
node --experimental-strip-types scripts/compare-ai.ts --audio /absolute/path/synthetic-consultation.wav --confirm-synthetic-audio --case chart-audio --dry-run
node --experimental-strip-types scripts/compare-ai.ts --audio /absolute/path/synthetic-consultation.wav --confirm-synthetic-audio --case chart-audio
```

WAV를 권장합니다. 확장자로 MIME을 알 수 없으면 `--audio-mime audio/wav`처럼 지정할 수 있습니다. 파일 내용은 두 엔진에 동일하게 전달되며 보고서에는 오디오 원문 base64 대신 해시·크기·MIME만 저장합니다. Astra가 별도 전사를 사용하는 경우 전사 모델이 `audioModel`에 기록됩니다. 원문 음성을 사용하는 Gemini와 전사 후 분석하는 OpenAI는 입력 처리 경로가 다르므로, 최종 출력의 의미 보존과 대화 피드백을 직접 검토해야 합니다.

## 전환 판단

HTML에는 8개 검토 항목이 있으며 모두 **검토 대기**로 시작합니다. 각 사례에서 사실 보존, 처방 설정 준수, 다음 선택의 구체성, 경과 해석, 어조·분량, 출력 계약, 허위 정보·금기, 실행·음성 품질을 비교합니다. 기존 경어체·짧은 항목·제목·볼드를 유지하는지, 불필요한 일반론이나 반복적 단서가 처방 제안을 대신하는지도 사람이 읽고 평가합니다.

입력 사실·함량·논문을 지어내거나, 확인된 알레르기를 무시하거나, 치료 제한을 위반하거나, 본문/JSON 처방이 다르거나, 음성의 중요한 정보를 오인하거나, 출력이 미완료이면 전환 판단을 보류합니다. 차트와 재평가의 외부 약재 계산·화면 표시·저장 동작은 별도 통합 테스트와 실제 화면에서도 확인해야 합니다. 이 도구는 Apps Script나 환자 시트 후처리를 실행하지 않습니다.

API 호출 성공·mock 테스트 통과·7개 합성 사례만으로 임상적 동등성이나 우월성을 입증할 수 없습니다. 보고서는 `clinicalEquivalence: not_established`를 유지하며 운영 기본값이나 Cloud Run 설정을 변경하지 않습니다. 실제 비교 결과를 원장님이 검토한 뒤 전환 여부를 결정합니다.


## 2026-11-11 결과와 OpenAI 재비교

첫 실측은 7건 × 두 엔진, 14개 요청 모두 완료됐으나 어조와 조제 설정 해석이 달라 운영 전환을 보류했습니다. 상세 비교는 [실측 검토](ai-comparison-review-2026-11-11.md)에 기록했습니다. 모델 API 완료와 임상 동등성은 별개의 판정입니다.

보완본은 원문 프롬프트를 유지하며 OpenAI 요청의 instructions에 원장 대상 문체, 원내 조제 합방과 중복 약재 MAX 처리, 실제 환자별 사유를 앞세운 간결한 권고를 명시합니다. 중요한 금기·누락 사실과 관찰/유지 선택도 보존합니다. 진단·효과 확률을 계산할 근거가 없으면 숫자를 만들지 않으므로 백분율 전용 화면 계약은 아직 검토 대상입니다.

기존 Cloud Shell 결과가 남아 있으면 다음 실행은 Gemini 결과를 다시 호출하지 않습니다.

```sh
python3 scripts/cloud-shell-compare.py --reuse-gemini
```

스크립트는 기존 프로젝트·리전의 첫 평가 커밋 `87dae4f47f6ba551bb02b4d0df4cb7bd86962b34` 아래 `comparison.json`을 찾습니다. 파일이 없거나 경로가 심볼릭 링크이면 중단하며 전체 14건 재실행으로 바꾸지 않습니다. 전체 사례·입력·오디오·원문 해시·실제 모델·결과 구조를 검증한 뒤 기존 Gemini 7개 결과만 재사용하고 새 OpenAI 7건을 요청합니다. 원래 시각과 평가 커밋은 provenance로 남기며 기존 파일은 덮어쓰지 않습니다. 같은 새 명령을 다시 실행하면 새 OpenAI의 완료 결과도 이어받습니다.

직접 실행할 때는 다음과 같이 원본 보고서를 지정할 수 있습니다. dry-run은 유료 요청 없이 재사용 가능 여부와 남은 요청 수를 확인합니다.

```sh
node --experimental-strip-types scripts/compare-ai.ts --baseline /path/to/comparison.json --dry-run
node --experimental-strip-types scripts/compare-ai.ts --baseline /path/to/comparison.json --out ./comparison-retest --resume
```

추가 지시 원문이나 해시, 현재 평가 커밋이 달라지면 현재 중간 결과를 재사용하지 않습니다. 음성·실제 UI·처방 계산 연동의 동작과 재비교된 어조를 확인하기 전에는 전환 완료로 판단하지 않습니다.
