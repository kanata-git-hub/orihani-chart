import { generateFollowUpResponse } from './followUpEngine.ts';
import { combinedParts } from './prescriptionRecipe.ts';
import type { SheetRows } from './prescriptionRecipe.ts';

export type GuideEntry = {
  number: string, name: string, aliases?: readonly string[], indication: string,
  url: string, title: string, excerpt?: string, combinationParts?: readonly string[],
};
type GuideOption = {
  rank: number, formula: string, reason: string, indications: string, combinationRationale: string,
  useHistory: string, references: {title: string, excerpt: string, url: string}[],
};
export type GuideSuggestions = {
  status: 'ok' | 'no_matches' | 'unavailable', message: string, recommendations: GuideOption[],
};
type Model = 'gpt-6.2-astra' | 'gemini-4-argon';

const normalize = (s: unknown) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const formulaKey = (s: unknown) => normalize(s).replace(/^륙/, '육');
const pairKey = (a: number, b: number) => a < b ? a + ',' + b : b + ',' + a;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Names and clinical free text stay on the server. History passed to the model contains
// only catalog IDs. A component used in a larger regimen counts as previously used.
export function guideUseHistory(rows: SheetRows, catalog: SheetRows, entries: readonly GuideEntry[]) {
  const headers = (rows[0] ?? []).map(normalize);
  const aliases = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    for (const alias of [entry.name, ...entry.aliases ?? [], 'TJ-' + entry.number, 'TJ' + entry.number]) {
      if (formulaKey(alias)) aliases.set(formulaKey(alias), index + 1);
    }
  }
  const fixedCombinations = new Map<number, number[]>();
  let nextHistoryOnlyId = entries.length + 1;
  for (const [index, entry] of entries.entries()) {
    const parts = entry.combinationParts?.map(name => {
      const key = formulaKey(name);
      // A classical component of a marketed fixed combination may have no separate TJ product.
      if (!aliases.has(key)) aliases.set(key, nextHistoryOnlyId++);
      return aliases.get(key)!;
    });
    if (parts?.length) fixedCombinations.set(index + 1, parts);
  }
  // Recognize an entire registered compound before its shorter constituent names.
  const formulaColumn = (catalog[0] ?? []).map(normalize).indexOf('처방명');
  const localNames = new Set(catalog.slice(1).map(row => formulaKey(row[formulaColumn])).filter(Boolean));
  const herbColumn = (catalog[0] ?? []).map(normalize).indexOf('약재명');
  const herbs = catalog.slice(1).map(row => normalize(row[herbColumn])).filter(Boolean);
  const buildMatcher = (names: Iterable<string>) => new RegExp([...new Set(names)].sort((a, b) => b.length - a.length)
    .map(name => escapeRegex(name) + (/\d$/.test(name) ? '(?!\\d)' : '')).join('|'), 'gu');
  const sourceMatcher = buildMatcher(aliases.keys());
  const idsByName = new Map<string, number[]>();
  for (const name of localNames) {
    // A sheet may register '쯔무라 제제명(TJ-43)', '제제명(탕전)', or a dosage annotation
    // as one local product. Map the official names/codes in such decorated labels.
    const ids = new Set<number>();
    const remainder = name.replace(sourceMatcher, match => { ids.add(aliases.get(match)!); return ''; });
    if (ids.size && !/[가-힣\p{Script=Han}a-z]/u.test(remainder.replace(
      /\([^)]*\)|쯔무라|츠무라|쓰무라|ツムラ|tsumura|엑스과립|엑스제|과립|탕전|농축|엑스|제제|그램|팩|배|mg|g|번/g, ''))) {
      idsByName.set(name, [...ids]);
    }
  }
  for (const [name, id] of aliases) idsByName.set(name, [id]);
  const names = [...localNames, ...aliases.keys()];
  const baseMatcher = buildMatcher(names);
  const additionMatcher = buildMatcher([...names, ...herbs]);
  const used = new Set<number>();
  const together = new Set<string>();
  let missingFormulaRows = 0;
  let partialRows = 0;
  let delivered = 0;
  for (const row of rows.slice(1)) {
    const cell = (name: string) => String(row[headers.indexOf(normalize(name))] ?? '').trim();
    if (!cell('효과')) continue; // The clinic uses blank to mark a prescription that was never delivered.
    delivered++;
    const combined = combinedParts(cell('처방 조합'));
    const base = [cell('처방'), cell('처방2'), cell('처방3'), combined.formulas].filter(Boolean);
    const additions = [cell('가'), combined.additions].filter(Boolean);
    const regimen = new Set<number>();
    let recognizedFormula = false;
    let uncertain = combined.invalid;
    const inspect = (field: string, matcher: RegExp) => {
      const normalized = normalize(field).replace(/(^|[+,、/])륙/g, '$1육');
      const rest = normalized.replace(matcher, match => {
        for (const id of idsByName.get(match) ?? []) regimen.add(id);
        if (localNames.has(match) || idsByName.has(match)) recognizedFormula = true;
        return '';
      });
      // Unknown names/abbreviations may prevent a complete negative-history determination.
      if (/[가-힣\p{Script=Han}a-z]/u.test(rest.replace(/쯔무라|츠무라|쓰무라|tsumura|없음|해당없음|그램|mg|g|배|팩|번/g, ''))) uncertain = true;
    };
    for (const field of base) inspect(field, baseMatcher);
    for (const field of additions) inspect(field, additionMatcher);
    if (!recognizedFormula) missingFormulaRows++;
    else if (uncertain) partialRows++;
    // Do not present a precombined Tsumura product as novel when the two underlying
    // formulas were prescribed together, or vice versa. No dose equivalence is implied.
    for (const [id, parts] of fixedCombinations) if (regimen.has(id)) for (const part of parts) regimen.add(part);
    for (const [id, parts] of fixedCombinations) if (parts.every(part => regimen.has(part))) regimen.add(id);
    for (const id of regimen) used.add(id);
    for (const a of regimen) for (const b of regimen) if (a < b) together.add(pairKey(a, b));
  }
  return { used, together, fixedCombinations, missingFormulaRows, partialRows, delivered };
}

const guidanceText = { type: 'string' };
const guideSchema = {
  type: 'object', additionalProperties: false, required: ['options'], properties: {
    options: { type: 'array', maxItems: 3, items: {
      type: 'object', additionalProperties: false,
      required: ['ids', 'reason', 'indications', 'combinationRationale'], properties: {
        ids: {type: 'array', minItems: 1, maxItems: 2, items: {type: 'integer', minimum: 1}},
        reason: guidanceText, indications: guidanceText, combinationRationale: guidanceText,
      },
    }},
  },
};

function shortText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 220 || /[<>\r\n]/.test(value)) {
    throw Error('Invalid guide explanation');
  }
  return value.trim();
}

// The evidence result carries only anonymized usage metadata for this request.
// Symbol keys are omitted from JSON returned to the browser.
export const guideHistoryKey = Symbol('guideHistory');
export async function recommendFromGuide(history: ReturnType<typeof guideUseHistory>, targets: string[],
  entries: readonly GuideEntry[], model: Model, generate = generateFollowUpResponse): Promise<GuideSuggestions> {
  const unavailable = (message: string): GuideSuggestions => ({status: 'unavailable', message, recommendations: []});
  if (!entries.length) return unavailable('참조할 쯔무라 제제 자료가 없습니다.');
  try {
    const {used, together, fixedCombinations, missingFormulaRows, partialRows, delivered} = history;
    if (missingFormulaRows && missingFormulaRows === delivered) return unavailable('전달 기록의 처방명을 식별할 수 없어 사용 여부를 대조할 수 없습니다.');
    const coverage = '전체 시트의 전달 기록을 처방명·별칭·제제번호로 대조했습니다.' +
      (missingFormulaRows ? ' 처방명을 식별할 수 없는 ' + missingFormulaRows + '건은 대조에서 제외했습니다.' : '') +
      (partialRows ? ' ' + partialRows + '건은 구성 일부만 확인했습니다.' : '');
    const prompt = [
      '한국 한의사가 검색한 목표 증상에 대해 공식 쯔무라 제제 자료에서 원내 시트에 사용 기록이 없는 처방 또는 조합을 유용성 순으로 최대 3개 고른다. 제공된 개별 제제의 적응증 문구만 근거로 쓴다. 임상 성공률, 약량, 자료에 없는 효능을 추정하지 않는다.',
      '단일 후보는 사용한 적 없는 제제로 제한한다(used=false). 기존 합방에 들어 있던 처방도 사용한 것으로 본다. 두 제제의 합방은 usedPairs에 없는 쌍만 가능하다. 이미 사용한 두 제제도 함께 쓴 기록이 없으면 합방은 후보가 될 수 있다. 복합 제제와 그 구성(fixedParts)이 겹치는 조합은 제외한다. 같은 처방을 복합 제제와 개별 구성의 합방으로 중복 추천하지 않는다.',
      '검색 목표와 직접 맞는 적응증, 환자에게 추가로 확인할 조건, 단일 제제로 설명할 수 있는지를 비교해 순위를 정한다. 단순히 약이 두 개여서 더 좋다는 이유로 합방하지 않는다. 합방은 각 제제가 맡는 별개의 증상·조건이 있고 함께 검토할 구체적 이유가 있을 때만 제안한다. 쯔무라가 합방을 권장했거나 실제 상승효과가 관찰된 것처럼 쓰지 않는다. 원내 효과 기록이나 환자 정보는 제공되지 않는다.',
      'reason에 추천 이유, indications에 어떤 증상 양상·판별 조건에서 우선 검토할지 쓴다. 합방의 combinationRationale에는 무엇을 더하면 무엇이 보완되는지, 어느 조건에서 단독보다 적합할 수 있는지 가설로 짧게 밝힌다. 단일의 combinationRationale은 빈 문자열이다. 한 제제가 검색 증상과 맞고 다른 제제가 특정 동반 증상에 쓰인다면 그 동반 증상은 확인이 필요한 조건으로 쓴다. 동일 목적의 유사 후보를 반복하지 않는다. 적합한 후보가 부족하면 줄이거나 빈 배열로 반환한다.',
      'options는 우선순위 순서이며 ids는 다음 자료의 내부 id 1~2개다. 다른 제제나 출처를 만들지 않는다. 모든 문구는 각 180자 이내 한국어로 쓴다. JSON만 반환한다.',
      JSON.stringify({ targets, usedPairs: [...together].map(pair => pair.split(',').map(Number))
        .filter(([,b]) => b <= entries.length),
        entries: entries.map((entry, index) => ({id: index + 1, name: entry.name,
          indication: entry.indication, used: used.has(index + 1),
          fixedParts: fixedCombinations.get(index + 1)?.filter(id => id <= entries.length)})) }),
    ].join('\n\n');
    const response = await generate(prompt, model === 'gpt-6.2-astra' ? 'gpt-astra' : 'gemini',
      {exactSearchModel: model, responseSchema: guideSchema});
    const raw = JSON.parse(response.text);
    if (!Array.isArray(raw?.options) || raw.options.length > 3) throw Error('Invalid guide result');
    const recommendations: GuideOption[] = [];
    const seen = new Set<string>();
    for (const option of raw.options) {
      const ids: number[] = option?.ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 ||
          ids.some(id => !Number.isInteger(id) || id < 1 || id > entries.length) || new Set(ids).size !== ids.length) {
        throw Error('Invalid guide references');
      }
      const [a, b] = ids;
      const key = b ? pairKey(a, b) : String(a);
      if (b ? together.has(key) : used.has(a)) continue;
      const expanded = ids.flatMap(id => fixedCombinations.get(id) ?? [id]);
      const compositionKey = [...expanded].sort((x, y) => x - y).join(',');
      if (new Set(expanded).size !== expanded.length || seen.has(compositionKey)) continue;
      seen.add(compositionKey);
      const medicines = ids.map(id => entries[id - 1]);
      const combinationRationale = b ? shortText(option.combinationRationale) : '';
      const usage = ids.filter(id => used.has(id)).map(id => entries[id - 1].name);
      const useHistory = (missingFormulaRows || partialRows ? '식별된 처방 기준 · ' : '') +
        (b ? '두 처방을 함께 쓴 기록 없음 · ' +
          (usage.length ? '개별 사용 기록 있음 (' + usage.join(', ') + ')' : '각 처방도 사용 기록 없음') : '단독·합방 구성 모두 사용 기록 없음');
      recommendations.push({rank: recommendations.length + 1, formula: medicines.map(entry => entry.name).join(' + '),
        reason: shortText(option.reason), indications: shortText(option.indications), combinationRationale, useHistory,
        references: medicines.map(entry => ({title: entry.title, excerpt: entry.excerpt || entry.indication, url: entry.url}))});
    }
    return {status: recommendations.length ? 'ok' : 'no_matches', recommendations, message:
      (recommendations.length ? '개별 제제의 적응증에 근거한 검토 순위입니다.' : '이 증상에 적합하고 사용 이력이 겹치지 않는 자료 후보를 찾지 못했습니다.') + ' ' + coverage};
  } catch {
    return unavailable('선택한 AI의 쯔무라 자료 분석을 확인할 수 없습니다. 다시 검색해주세요.');
  }
}
