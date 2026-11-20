import { CLINIC_PRESCRIPTION_GUIDANCE } from './clinicPrescriptionGuidance.ts';
import { generateFollowUpResponse } from './followUpEngine.ts';
import { comparePrescriptionEvidence, rankPrescriptions } from './prescriptionSearch.ts';
import type { clinicalEvidence, RankedPrescription } from './prescriptionSearch.ts';

type Clinic = ReturnType<typeof clinicalEvidence>;
type SearchModel = 'gpt-6.2-astra' | 'gemini-4-argon';
type Insight = { formula: string, detail: string, guidance: string };
type Choice = { id: number, detail: string, guidance: string };

function readChoices(text: string, candidates: RankedPrescription[], count: number): Choice[] {
  const json = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  const choices: unknown = JSON.parse(json);
  if (!Array.isArray(choices) || choices.length !== count) throw new Error('Invalid shortlist');
  const used = new Set<number>();
  for (const [index, choice] of choices.entries()) {
    if (!choice || !Number.isInteger(choice.id) || choice.id < 1 || choice.id > candidates.length || used.has(choice.id)) {
      throw new Error('Invalid candidate');
    }
    // A model may select among equivalent records, but cannot demote stronger sheet evidence.
    if (comparePrescriptionEvidence(candidates[choice.id - 1], candidates[index]) !== 0) throw new Error('Invalid rank');
    for (const field of [choice.detail, choice.guidance]) {
      if (typeof field !== 'string' || field.length > 160 || /[\r\n|`#*<>]/.test(field)) throw new Error('Invalid explanation');
    }
    used.add(choice.id);
  }
  return choices;
}

export async function recommendPrescriptions(clinic: Clinic, query: string, model: SearchModel, generate = generateFollowUpResponse) {
  const ordered = rankPrescriptions(clinic);
  const top = ordered.slice(0, 3);
  const insights: Insight[] = [];
  if (!top.length) {
    const text = clinic.groups.length ? '평가 기록 중 ‘좋음’인 처방이 없습니다.' : '이 증상으로 평가된 처방 기록이 없습니다.';
    return { rankings: top, insights, text };
  }
  // Include every candidate tied for the last place, even when there are more than three.
  const cutoff = top[top.length - 1];
  const candidates = ordered.filter(item => comparePrescriptionEvidence(item, cutoff) <= 0);
  const byFormula = new Map(clinic.groups.map(group => [group.formula, group]));
  const evidence = candidates.map((item, index) => ({
    id: index + 1,
    허용순위: top.flatMap((slot, i) => comparePrescriptionEvidence(item, slot) === 0 ? [i + 1] : []),
    ...item,
    sheet: byFormula.get(item.formula),
  }));
  const prompt = [
    '증상별 처방 검색이다. 검색 증상이 기재된 행의 V열 좋음은 항상 긍정 사례다. W열이 비거나 검색 증상을 다시 언급하지 않아도 긍정으로 센다. 언급이 없다는 이유로 미호전·무효로 보거나 추천을 유보하지 않는다.',
    'W열은 실제로 적힌 호전 정도, 잔존, 악화, 이상반응을 설명할 때 쓴다. 좋음과 명시적 악화가 같이 있으면 둘 다 밝힌다. 동반 증상의 경과를 검색 증상의 경과로 단정하지 않는다. notes와 details는 같은 기록이므로 중복 집계하지 않는다.',
    '각 후보의 허용순위 안에서만 선택한다. 같은 순위에 들어갈 수 있는 후보들은 검색 증상에 대한 상세 문맥과 다음 원내 지침의 적합성으로 결정한다. 구분할 근거가 없으면 제시된 순서대로 고른다. 처방조합은 한 후보로 유지한다.',
    CLINIC_PRESCRIPTION_GUIDANCE,
    '이 검색은 기존 후보의 비교만 다룬다. 시트 밖의 처방이나 새로운 조합·복용법을 제안하지 않는다. 다음 환자의 치료 확률이나 원문을 확인하지 않은 쯔무라 적응증을 만들지 않는다.',
    JSON.stringify({ 증상: query.trim(), 후보: evidence }),
    '상위 ' + top.length + '개를 순서대로 JSON 배열로만 반환한다. 각 항목의 형식은 {"id":1,"detail":"W열에 기록된 경과 한 문장","guidance":"원내 지침을 적용한 짧은 해석 한 문장"}이다. 두 설명은 각각 80자 이내, 근거가 없으면 빈 문자열이다. 표·마크다운·항목별 주의사항·확률·추가 요약은 출력하지 않는다.',
  ].join('\n\n');
  try {
    const result = await generate(prompt, model === 'gpt-6.2-astra' ? 'gpt-astra' : 'gemini', { exactSearchModel: model });
    const choices = readChoices(result.text, candidates, top.length);
    const rankings = choices.map(choice => candidates[choice.id - 1]);
    for (const [i, choice] of choices.entries()) {
      const formula = rankings[i].formula;
      const group = byFormula.get(formula)!;
      insights.push({
        formula,
        detail: group.notes.length || group.details.length ? choice.detail.trim() : '',
        guidance: choice.guidance.trim(),
      });
    }
    // Older open tabs display the text field until the client next reloads.
    const text = rankings.map((item, i) => (i + 1) + '위 ' + item.formula + ' · 좋음 ' + item.good + '/' + item.total + '건').join('\n');
    return { rankings, insights, model: result.model, text };
  } catch {
    return { rankings: top, insights, text: 'AI 해석을 받지 못해 시트 기록으로 순위를 정했습니다.' };
  }
}
