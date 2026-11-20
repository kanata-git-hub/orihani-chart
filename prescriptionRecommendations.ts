import { CLINIC_PRESCRIPTION_GUIDANCE } from './clinicPrescriptionGuidance.ts';
import { generateFollowUpResponse } from './followUpEngine.ts';
import { componentEvidence } from './prescriptionSearch.ts';
import { prescriptionSynthesisSchema } from './prescriptionSynthesisSchema.ts';
import { guideHistoryKey, recommendFromGuide } from './guideSuggestions.ts';
import { tsumuraMonographs } from './tsumuraMonographs.ts';
import type { clinicalEvidence } from './prescriptionSearch.ts';

type Clinic = ReturnType<typeof clinicalEvidence>;
type Component = ReturnType<typeof componentEvidence>[number];
type Counts = Component['included'];
type SearchModel = 'gpt-6.2-astra' | 'gemini-4-argon';
type MatchedComparison = { baseGroupId: number, addedGroupId: number };
type Addition = {
  formulas: string[], when: string, why: string, kind: 'observed' | 'within-larger' | 'hypothesis',
  groupIds: number[], matchedComparisons: MatchedComparison[],
};
export type PrescriptionRecommendation = {
  base: string, headline: string, reason: string, limitation: string, guidance: string, groupIds: number[],
  study: { included: Counts, solo: Counts, combined: Counts, absent: Counts, regimenCount: number,
    targetImproved: number, targetCaution: number, otherTargets: Component['otherTargets'] },
  additions: Addition[],
};
type Synthesis = {
  status: 'synthesized' | 'insufficient' | 'model-unavailable',
  recommendations: PrescriptionRecommendation[], text: string, model?: string, shortlistNote?: string,
};

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid object');
  return value as Record<string, unknown>;
}

function sentence(value: unknown, optional = false): string {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > 180 || /[\r\n<>]/.test(value)) {
    throw Error('Invalid explanation');
  }
  return value.trim();
}

function idList(value: unknown, range: number, limit: number): number[] {
  if (!Array.isArray(value) || !value.length || value.length > limit ||
      value.some(id => !Number.isInteger(id) || id < 1 || id > range) || new Set(value).size !== value.length) {
    throw Error('Invalid evidence reference');
  }
  return value as number[];
}

const regimenKey = (names: string[]) => JSON.stringify([...names].sort());

function hasSupport(group: Clinic['groups'][number]): boolean {
  if (group.좋음 > 0) return true;
  // An overall neutral grade may still document relief of one of several treatment targets.
  return group.contexts.some(context => context.grade === '보통' && context.feedback.some(finding =>
    (finding.대상 === '검색 증상' || context.targets.some(term => finding.대상 === '검색 증상: ' + term)) &&
    (finding.경과 === '호전' || (finding.경과 === '수치 감소' && finding.정도.startsWith('강도 ')))
  ));
}

function readAddition(value: unknown, base: Component, clinic: Clinic, components: Component[],
  groupIdByRegimen: Map<string, number>): Addition {
  const item = object(value);
  const formulas = idList(item.componentIds, components.length, 2).map(id => components[id - 1].formula);
  if (formulas.includes(base.formula)) throw Error('Base repeated in addition');
  const groupIds = idList(item.groupIds, clinic.groups.length, 12);
  const cited = groupIds.map(id => clinic.groups[id - 1]);
  const members = [base.formula, ...formulas];
  if (cited.some(group => !members.some(name => group.components.includes(name)))) throw Error('Unrelated regimen');
  const exactId = groupIdByRegimen.get(regimenKey(members));
  const withAll = clinic.groups.filter(group => members.every(name => group.components.includes(name)));
  const kind = exactId ? 'observed' : withAll.length ? 'within-larger' : 'hypothesis';
  if (kind === 'hypothesis') {
    // Independent positive records motivate a hypothesis. They never count as a trial of the new combination.
    if (!members.every(name => cited.some(group => hasSupport(group) && group.components.includes(name)))) {
      throw Error('Unsupported combination hypothesis');
    }
  } else {
    const relevant = exactId ? [clinic.groups[exactId - 1]] : withAll;
    if (!relevant.some(group => hasSupport(group) && cited.includes(group))) throw Error('No supported cited joint use');
  }
  const matchedComparisons: MatchedComparison[] = [];
  for (const group of withAll) {
    const without = group.components.filter(name => !formulas.includes(name));
    const baseGroupId = groupIdByRegimen.get(regimenKey(without));
    if (baseGroupId) matchedComparisons.push({baseGroupId, addedGroupId: groupIdByRegimen.get(regimenKey(group.components))!});
  }
  return { formulas, when: sentence(item.when), why: sentence(item.why), kind, groupIds, matchedComparisons };
}

// The model selects which evidence made the difference in rank; the chart supplies the numbers and wording.
function evidenceHeadline(focus: unknown, base: Component, clinic: Clinic) {
  const groups=base.groupIds.map(id=>clinic.groups[id-1]);
  const solo=groups.find(g=>g.components.length===1);
  const goodCombinations=groups.filter(g=>g.components.length>1 && g.좋음>0).length;
  const label=clinic.targets.length===1?clinic.targets[0]:'검색 목표 중 한 가지 이상';
  if (focus==='backgroundUse') {
    const backgroundTotal=base.otherTargets.included.total+base.otherTargets.absent.total;
    if (backgroundTotal>0) {
      return `사용 빈도 · 검색 목표 ${base.included.total}/${base.included.total+base.absent.total}건, 다른 목표 ${base.otherTargets.included.total}/${backgroundTotal}건`;
    }
  }
  if (focus==='contrast' && base.absent.total) {
    return `전체 평가 좋음 · 포함 ${base.included.good}/${base.included.total}건, 미포함 ${base.absent.good}/${base.absent.total}건`;
  }
  if (focus==='solo' && solo?.좋음) {
    const single=solo.가감기록===0?'무가감 단독':'단독(가감 포함)';
    return `${single} ${solo.기록}건 중 ${solo.좋음}건 좋음`;
  }
  if (focus==='recurrence' && goodCombinations>0 && (solo?.좋음 || goodCombinations>1)) {
    const uses=solo?.좋음?'단독과 합방':'서로 다른 합방';
    return `${uses} ${goodCombinations}종에서 좋음 기록`;
  }
  if (base.targetImproved>0 && (focus==='targetFeedback' || !base.included.good)) {
    return `상세에 ${label} 호전 명시 ${base.targetImproved}건`;
  }
  return `${label} 관련 전체 평가 ${base.included.total}건 중 ${base.included.good}건 좋음`;
}

function readRecommendations(raw: string, clinic: Clinic, components: Component[]) {
  const payload = object(JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i, '$1')));
  if (!Array.isArray(payload.recommendations) || payload.recommendations.length > 3) throw Error('Invalid clinical options');
  const used = new Set<number>();
  const groupIdByRegimen = new Map(clinic.groups.map((group, i) => [regimenKey(group.components), i + 1]));
  const recommendations:PrescriptionRecommendation[]=payload.recommendations.map(value => {
    const item = object(value);
    const [id] = idList([item.baseId], components.length, 1);
    if (used.has(id)) throw Error('Repeated base');
    used.add(id);
    const base = components[id - 1];
    const groupIds = idList(item.groupIds, clinic.groups.length, 12);
    if (groupIds.some(groupId => !base.groupIds.includes(groupId)) ||
        !groupIds.some(groupId => hasSupport(clinic.groups[groupId - 1]))) throw Error('Unsupported base');
    if (!Array.isArray(item.additions) || item.additions.length > 2) throw Error('Invalid additions');
    const additions = item.additions.map(option => readAddition(option, base, clinic, components, groupIdByRegimen));
    const distinctOptions = new Set(additions.map(option => regimenKey(option.formulas)));
    if (distinctOptions.size !== additions.length) throw Error('Repeated add-on option');
    return {
      base: base.formula, headline: evidenceHeadline(item.rankBasis,base,clinic), reason: sentence(item.reason), limitation: sentence(item.limitation),
      guidance: sentence(item.guidance, true), groupIds, additions,
      study: { included: base.included, solo: base.solo, combined: base.combined, absent: base.absent, regimenCount: base.groupIds.length,
        targetImproved: base.targetImproved, targetCaution: base.targetCaution, otherTargets: base.otherTargets },
    };
  });
  let shortlistNote='';
  if (recommendations.length>0 && recommendations.length<3) {
    const eligible=components.filter(c=>c.groupIds.some(id=>hasSupport(clinic.groups[id-1]))).length;
    if (eligible===recommendations.length) {
      shortlistNote=`검색 기록에서 긍정 근거가 있는 기본 처방 후보는 ${eligible}개입니다.`;
    } else {
      shortlistNote=sentence(payload.shortlistNote??'',true) ||
        `긍정 기록에 포함된 구성 처방 ${eligible}개 중 모델이 독립된 기본 후보로 선정한 것은 ${recommendations.length}개입니다.`;
    }
  }
  return {recommendations,shortlistNote};
}

async function recommendFromClinic(clinic: Clinic, model: SearchModel,
  generate: typeof generateFollowUpResponse): Promise<Synthesis> {
  if (!clinic.groups.some(hasSupport)) {
    const text = clinic.groups.length ? '‘좋음’으로 평가한 기록이 없고, ‘보통’ 기록의 상세란에서도 검색 증상의 호전을 확인하지 못했습니다.' : '이 증상으로 평가된 처방 기록이 없습니다.';
    return { status: 'insufficient', recommendations: [], text };
  }
  const components = componentEvidence(clinic);
  const evidence = {
    targets: clinic.targets,
    components: components.map((component, i) => ({ id: i + 1, ...component })),
    groups: clinic.groups.map((group, i) => ({
      id: i + 1, formula: group.formula, components: group.components, good: group.좋음, neutral: group.보통,
      bad: group.나쁨, modified: group.가감기록, missingFeedback: group.상세미기록,
      targetImproved: group.targetImproved, targetCaution: group.targetCaution, contexts: group.contexts,
    })),
  };
  const prompt = [
    '원장이 검색한 증상에서 기본으로 검토할 단일 처방과 필요한 조건부 합방을 추론한다. 모든 시트 기록을 함께 비교하고, 기존 조합의 긍정률이나 빈도로 미리 정한 순위는 없다. 같은 처방이 서로 다른 조합에서 반복되는지, 특정 짝과 늘 같이 쓰였는지, 그 처방이 없는 다른 사례에서도 비슷하게 좋아졌는지 확인한다.',
    '건수는 시트 행 수다. 같은 환자의 재진이 있을 수 있어 독립 환자 수나 인과 효과로 해석하지 않는다. V열 좋음은 W열이 비어도 긍정 사례다. 보통·나쁨 및 W열의 검색 증상별 호전·악화·재발을 함께 본다. 등급은 그 행 전체 처방의 반응이다. 여러 목표 중 무엇이 변했는지는 그 행의 contexts를 확인한다. coSymptoms는 시트에 언급된 증상으로, 부정 표현을 놓칠 수 있다. 언급만으로 실제 동반 질환이나 그 증상의 호전을 단정하지 않는다. 일부 목표만 겹친 행과 여러 기록의 증상을 합치지 않는다.',
    '아래에서 긍정 근거는 V열 좋음, 또는 V열 보통이면서 같은 W열에 검색한 목표 증상의 호전이 명시된 경우다. 후자는 전체 등급을 보통으로 유지하고 좋아진 목표와 남은 문제를 구분한다. 같은 후보에 명시된 이상반응·금기·악화 기록은 경과 및 limitation에 반영한다.',
    '같은 검색 증상에서 구성 처방 포함/미포함(included/absent), 단독/합방(solo/combined), 동반 목표, 가감 여부 및 상세 경과를 대조한다. otherTargets는 검색어가 하나도 일치하지 않는 증상 기록 중 평가·처방 식별이 가능한 행의 포함/미포함 등급 집계다. 다른 증상에서도 자주 쓰였는지 분모와 함께 확인해 단순한 원내 빈용과 검색 증상에서 두드러지는 패턴을 구별한다. 목표·구성·표본이 다르므로 집단의 단순 비율 차이를 치료 효과나 처방 우위로 확정하지 않는다. 늘 같은 짝이거나 가감·동반 목표를 분리할 수 없으면 limitation에 짧게 쓴다.',
    '모든 행의 V=좋음을 긍정으로 반영한다. ‘피로를 목표로 한 4건이 전체 좋음’과 ‘상세에서 피로 자체 호전이 명시된 4건’은 구별한다. 전자는 등급(included.good), 후자는 targetImproved를 사용한다. 여러 검색어일 때 targetImproved는 해당 행에 기록된 검색 목표 중 하나 이상이며 모든 목표가 좋아졌다는 뜻이 아니다. 검색 목표의 악화·잔존 등 targetCaution, 동반 증상만 변한 경우, 가감 단독과 무가감 단독도 구분한다. when은 판단 조건이며 확인되지 않은 동반 증상을 현재 환자의 소견처럼 쓰지 않는다.',
    '같은 기본 처방에 다른 처방을 더하려면 어떤 남은 증상·동반 증상 또는 반응에서 무엇을 보완할지 when·why에 밝힌다. 가능하면 나머지 구성은 같고 보조 처방만 다른 matched 쌍을 비교한다. 관찰 사례의 차이를 추가 처방의 인과 효과로 쓰지 않는다. 같은 짝이 여러 처방에 끼어 있을 뿐이면 다른 구성의 영향도 남는다. 새 조합은 각 구성에 별도의 적절한 긍정 근거가 있고 환자 조건과 원내 지침으로 보완 이유를 설명할 수 있을 때만 가설로 제안한다. 뚜렷한 추가 이유가 없으면 additions를 비우고 기본 처방만 검토할 이유나 추가를 지지할 비교가 부족하다는 점을 reason 또는 limitation에 짧게 쓴다.',
    '실제 시트 관찰이 주된 근거다. 다음 처방 재평가실 지침은 가능한 적용 조건을 설명할 때 쓰며 지침에서 얻은 해석은 guidance에 구분한다. 시트 밖의 적응증·쯔무라 원문 인용·약량·개인 치료확률을 만들지 않는다.',
    CLINIC_PRESCRIPTION_GUIDANCE,
    JSON.stringify(evidence),
    '기본 후보를 종합적으로 1~3위까지 비교한다. 먼저 쓸 후보와 조건부로 더할 후보를 구분한다. reason에는 이 후보가 가까운 다른 후보보다 이 순서에 온 결정적인 근거를 쓴다. rankBasis는 실제 비교에서 우선한 한 가지를 고른다: solo(단독 긍정 평가), recurrence(긍정적인 서로 다른 합방 또는 단독과 합방에 반복), targetFeedback(검색 목표 자체의 상세 호전), contrast(같은 증상에서 미포함군과 등급 비교), backgroundUse(검색 목표와 다른 목표 기록 사이의 구성 처방 사용 빈도 비교), overall(긍정 등급). 사용 빈도 자체로 효과를 판단하지 않는다. 직접 비교할 수 없는 사례에는 대비 효과를 주장하지 않는다.',
    '추가 처방은 합방 사용을 관찰한 것과 추가 효과를 구분한다. 서로 다른 행의 단독과 합방은 동일인의 투여 전후 비교가 아니다. 상세 결과가 부종이나 복통 등 동반 증상에만 있으면 그 동반 증상에 대한 보완 가설로 한정한다. 숫자 ID는 구조화된 참조에만 쓰고 설명문에는 실제 처방명을 쓴다. 독립 후보가 3개에 못 미치면 1~2개만 제시하고 shortlistNote 한 문장에 나머지를 독립 추천하기 어려운 자료상의 이유를 쓴다. 3개 또는 0개일 때는 빈 문자열이다.',
    '응답 형식: {"recommendations":[{"baseId":1,"rankBasis":"recurrence","reason":"다른 후보와 비교한 순위 근거","limitation":"반례 또는 구분하기 어려운 효과","guidance":"원내 지침의 적용 조건 또는 빈 문자열","groupIds":[1,2],"additions":[{"componentIds":[2],"when":"추가할 조건","why":"해당 증상의 실제 관찰과 추가 처방의 보완 가설","groupIds":[2]}]}],"shortlistNote":"선정 후보가 1~2개일 때의 이유"}.',
    'ID는 제공된 자료에서 고른다. baseId와 componentIds는 단일 처방 ID, groupIds는 실제 조합 기록 ID다. 각 기본 처방은 그 처방이 포함된 근거(긍정 사례 하나 이상)를 인용한다. 각 추가안은 1~2가지 처방이며 최대 2개 대안이다. 제안한 정확한 조합이 있으면 그 긍정 사례를, 더 큰 합방 안에서만 함께 쓰였다면 그 사실을 적고 해당 긍정 사례를 인용한다. 함께 쓴 적이 없는 제안은 기본 처방과 추가 성분 각각의 긍정 사례를 인용한다. 각 문구는 쉬운 한국어 한두 문장, 150자 이내다. 계산표나 마크다운 없이 JSON만 출력한다.',
  ].join('\n\n');
  try {
    const response = await generate(prompt, model === 'gpt-6.2-astra' ? 'gpt-astra' : 'gemini', {
      exactSearchModel: model, responseSchema: prescriptionSynthesisSchema,
    });
    const {recommendations,shortlistNote} = readRecommendations(response.text, clinic, components);
    return {
      status: recommendations.length ? 'synthesized' : 'insufficient',
      model: response.model,
      recommendations,
      shortlistNote,
      text: recommendations.length ? recommendations[0].base + ' · ' + recommendations[0].reason : '이 기록만으로는 기본 처방을 구분할 근거가 부족합니다.',
    };
  } catch {
    return { status: 'model-unavailable', recommendations: [], text: '선택한 AI의 종합 판단을 확인할 수 없습니다. 다시 검색하거나 아래 시트 기록을 확인해주세요.' };
  }
}

type Generator = typeof generateFollowUpResponse;
// Older integrations can inject a single generator for clinic-only synthesis.
// The regular authenticated search runs two independent analyses with the same chosen model.
export async function recommendPrescriptions(clinic: Clinic, _query: string, model: SearchModel,
  generators: Generator | {clinic: Generator, guide: Generator} = {clinic: generateFollowUpResponse, guide: generateFollowUpResponse}) {
  if (typeof generators === 'function') return recommendFromClinic(clinic, model, generators);
  const [synthesis, guideSuggestions] = await Promise.all([
    recommendFromClinic(clinic, model, generators.clinic),
    recommendFromGuide(clinic[guideHistoryKey], clinic.targets, tsumuraMonographs, model, generators.guide),
  ]);
  return {...synthesis, guideSuggestions};
}
