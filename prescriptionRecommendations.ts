import { CLINIC_PRESCRIPTION_GUIDANCE } from './clinicPrescriptionGuidance.ts';
import { generateFollowUpResponse } from './followUpEngine.ts';
import { componentEvidence } from './prescriptionSearch.ts';
import { prescriptionSynthesisSchema } from './prescriptionSynthesisSchema.ts';
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
  base: string, reason: string, limitation: string, guidance: string, groupIds: number[],
  study: { included: Counts, solo: Counts, combined: Counts, absent: Counts, regimenCount: number },
  additions: Addition[],
};
type Synthesis = {
  status: 'synthesized' | 'insufficient' | 'model-unavailable',
  recommendations: PrescriptionRecommendation[], text: string, model?: string,
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

function readRecommendations(raw: string, clinic: Clinic, components: Component[]): PrescriptionRecommendation[] {
  const payload = object(JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i, '$1')));
  if (!Array.isArray(payload.recommendations) || payload.recommendations.length > 3) throw Error('Invalid clinical options');
  const used = new Set<number>();
  const groupIdByRegimen = new Map(clinic.groups.map((group, i) => [regimenKey(group.components), i + 1]));
  return payload.recommendations.map(value => {
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
      base: base.formula, reason: sentence(item.reason), limitation: sentence(item.limitation),
      guidance: sentence(item.guidance, true), groupIds, additions,
      study: { included: base.included, solo: base.solo, combined: base.combined, absent: base.absent, regimenCount: base.groupIds.length },
    };
  });
}

export async function recommendPrescriptions(clinic: Clinic, _query: string, model: SearchModel,
  generate = generateFollowUpResponse): Promise<Synthesis> {
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
      bad: group.나쁨, modified: group.가감기록, missingFeedback: group.상세미기록, contexts: group.contexts,
    })),
  };
  const prompt = [
    '원장이 검색한 증상에서 기본으로 검토할 단일 처방과 필요한 조건부 합방을 추론한다. 모든 시트 기록을 함께 비교하고, 기존 조합의 긍정률이나 빈도로 미리 정한 순위는 없다. 같은 처방이 서로 다른 조합에서 반복되는지, 특정 짝과 늘 같이 쓰였는지, 그 처방이 없는 다른 사례에서도 비슷하게 좋아졌는지 확인한다.',
    '건수는 시트 행 수다. 같은 환자의 재진이 있을 수 있어 독립 환자 수나 인과 효과로 해석하지 않는다. V열 좋음은 W열이 비어도 긍정 사례다. 보통·나쁨 및 W열의 검색 증상별 호전·악화·재발을 함께 본다. 등급은 그 행 전체 처방의 반응이다. 여러 목표 중 무엇이 변했는지는 그 행의 contexts를 확인한다. coSymptoms는 시트에 언급된 증상으로, 부정 표현을 놓칠 수 있다. 언급만으로 실제 동반 질환이나 그 증상의 호전을 단정하지 않는다. 일부 목표만 겹친 행과 여러 기록의 증상을 합치지 않는다.',
    '아래에서 긍정 근거는 V열 좋음, 또는 V열 보통이면서 같은 W열에 검색한 목표 증상의 호전이 명시된 경우다. 후자는 전체 등급을 보통으로 유지하고 좋아진 목표와 남은 문제를 구분한다. 같은 후보에 명시된 이상반응·금기·악화 기록은 경과 및 limitation에 반영한다.',
    '각 기본 후보는 포함/미포함(included/absent), 단독/합방(solo/combined), 서로 다른 구성 수와 실제 contexts를 대조해 선택한다. 늘 같은 짝이거나 단독 기록이 없으면 단독 효과는 분리되지 않는다고 limitation에 쓴다. 소표본이나 다른 치료 목표, 가감, 반대 결과도 밝힌다. 쓸 만한 단독 기록이 있다면 한 가지부터 검토할 조건을 설명한다. 독립된 대안이 없으면 3개를 억지로 채우지 않는다.',
    '같은 기본 처방에 다른 처방을 더하려면 어떤 남은 증상·동반 증상 또는 반응에서 무엇을 보완할지 when·why에 밝힌다. 가능하면 나머지 구성은 같고 보조 처방만 다른 matched 쌍을 비교한다. 관찰 사례의 차이를 추가 처방의 인과 효과로 쓰지 않는다. 같은 짝이 여러 처방에 끼어 있을 뿐이면 다른 구성의 영향도 남는다. 새 조합은 각 구성에 별도의 적절한 긍정 근거가 있고 환자 조건과 원내 지침으로 보완 이유를 설명할 수 있을 때만 가설로 제안한다. 뚜렷한 추가 이유가 없으면 additions를 비우고 기본 처방만 검토할 이유나 추가를 지지할 비교가 부족하다는 점을 reason 또는 limitation에 짧게 쓴다.',
    '실제 시트 관찰이 주된 근거다. 다음 처방 재평가실 지침은 가능한 적용 조건을 설명할 때 쓰며 지침에서 얻은 해석은 guidance에 구분한다. 시트 밖의 적응증·쯔무라 원문 인용·약량·개인 치료확률을 만들지 않는다.',
    CLINIC_PRESCRIPTION_GUIDANCE,
    JSON.stringify(evidence),
    '기본 처방 1~3개를 환자 조건에 대한 적합성과 근거를 종합해 우선 검토할 순서로 제시한다. 근거 부족이면 빈 배열도 가능하다. 응답 형식: {"recommendations":[{"baseId":1,"reason":"공통 처방을 선택한 이유","limitation":"반대 사례 또는 어떤 효과를 구분할 수 없는지","guidance":"원내 지침의 적용 조건 또는 빈 문자열","groupIds":[1,2],"additions":[{"componentIds":[2],"when":"추가할 구체적 조건","why":"어떤 문제를 보완하며 기본 처방만 쓸 때보다 어떤 점을 기대하는지와 그 근거","groupIds":[2]}]}]}.',
    'ID는 제공된 자료에서 고른다. baseId와 componentIds는 단일 처방 ID, groupIds는 실제 조합 기록 ID다. 각 기본 처방은 그 처방이 포함된 근거(긍정 사례 하나 이상)를 인용한다. 각 추가안은 1~2가지 처방이며 최대 2개 대안이다. 제안한 정확한 조합이 있으면 그 긍정 사례를, 더 큰 합방 안에서만 함께 쓰였다면 그 사실을 적고 해당 긍정 사례를 인용한다. 함께 쓴 적이 없는 제안은 기본 처방과 추가 성분 각각의 긍정 사례를 인용한다. 각 문구는 쉬운 한국어 한두 문장, 150자 이내다. 계산표나 마크다운 없이 JSON만 출력한다.',
  ].join('\n\n');
  try {
    const response = await generate(prompt, model === 'gpt-6.2-astra' ? 'gpt-astra' : 'gemini', {
      exactSearchModel: model, responseSchema: prescriptionSynthesisSchema,
    });
    const recommendations = readRecommendations(response.text, clinic, components);
    return {
      status: recommendations.length ? 'synthesized' : 'insufficient',
      model: response.model,
      recommendations,
      text: recommendations.length ? recommendations[0].base + ' · ' + recommendations[0].reason : '이 기록만으로는 기본 처방을 구분할 근거가 부족합니다.',
    };
  } catch {
    return { status: 'model-unavailable', recommendations: [], text: '선택한 AI의 종합 판단을 확인할 수 없습니다. 다시 검색하거나 아래 시트 기록을 확인해주세요.' };
  }
}
