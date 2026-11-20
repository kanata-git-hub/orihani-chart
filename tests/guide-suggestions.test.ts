import test from 'node:test';
import assert from 'node:assert/strict';
import { guideUseHistory, recommendFromGuide as recommendWithHistory } from '../guideSuggestions.ts';
import type { GuideEntry } from '../guideSuggestions.ts';
import type { SheetRows } from '../prescriptionRecipe.ts';
import type { generateFollowUpResponse } from '../followUpEngine.ts';

const entries: GuideEntry[] = ['육가탕','나탕','다탕','라탕','마탕','가나합방'].map((name, i) =>
  ({name, number: String(i + 1), indication: '가상 제제 ' + name + '의 용도', url: 'https://example.invalid/' + i, title: name + ' 자료'}));
entries[1].aliases = ['나처방'];
entries[5].combinationParts = ['육가탕','나탕'];
const header = ['성함', '증상', '처방', '처방2', '가', '처방 조합', '효과', '효과(자세히)'];
const catalog = [['처방명', '약재명'], ['쯔무라육가탕(TJ-1)', '감초'], ['원내특수방', '감초']];
const row = (rx: string, grade = '좋음', addition = '', combined = '') =>
  ['비공개성함', '다른 증상', rx, '', addition, combined, grade, '비공개장소와 연락처'];
const option = (ids: number[]) => ({ids, reason: '검색 증상과 맞습니다.', indications: '동반 증상을 확인하세요.', combinationRationale: ids.length === 2 ? '각각 다른 증상에 쓰는 조건입니다.' : ''});
const recommendFromGuide = (rows: SheetRows, catalog: SheetRows, targets: string[], entries: GuideEntry[],
  model: 'gpt-6.2-astra' | 'gemini-4-argon', generate: typeof generateFollowUpResponse) =>
  recommendWithHistory(guideUseHistory(rows, catalog, entries), targets, entries, model, generate);
const generateMock = (options: unknown[], check?: (prompt:string) => void): typeof generateFollowUpResponse =>
  async (prompt, engine, config) => {
    assert.equal(config.exactSearchModel, engine === 'gpt-astra' ? 'gpt-6.2-astra' : 'gemini-4-argon');
    assert.ok(config.responseSchema);
    check?.(String(prompt));
    return {text: JSON.stringify({options}), engine: 'gemini', model: String(config.exactSearchModel)};
  };

test('dispensed records across all symptoms count, including unclear outcomes, named additions, and fixed combinations', () => {
  const rows = [header, row('쯔무라육가탕(TJ-1)', '미정', '나처방 + 감초'),
    row('', '종결', '', '다탕 (가: 라탕, 감: 마탕)'), row('마탕', ''), row('원내특수방'), row('불명'), row('륙가탕+알수없는방')];
  const history = guideUseHistory(rows, catalog, entries);
  assert.deepEqual([...history.used].sort(), [1, 2, 3, 4, 6]);
  assert.ok(history.together.has('1,2') && history.together.has('3,4'));
  assert.ok(!history.together.has('1,3'));
  assert.equal(history.missingFormulaRows, 1);
  assert.equal(history.partialRows, 1);
  const fixed = guideUseHistory([header, row('가나합방')], catalog, entries);
  assert.deepEqual([...fixed.used].sort(), [1,2,6]);
  const decorated = guideUseHistory([header, row('쯔무라육가탕(TJ-1)')], catalog, entries);
  assert.deepEqual([...decorated.used], [1]);
  const customPart: GuideEntry[] = [...entries, {...entries[0], number:'7', name:'별도합방', combinationParts:['라탕','시트전용방']}];
  assert.ok(guideUseHistory([header,row('라탕 + 시트전용방')], catalog, customPart).used.has(7));
  assert.ok(guideUseHistory([header,row('별도합방')], catalog, customPart).used.has(4));
});

test('returns independently ranked source-anchored singles/new combinations even with no evaluated target-specific records', async () => {
  const rows = [header, row('라탕','종결'), row('나처방','미정'), row('육가탕','')];
  for (const model of ['gpt-6.2-astra', 'gemini-4-argon'] as const) {
    const result = await recommendFromGuide(rows, catalog, ['피로'], entries, model,
      generateMock([option([4]),option([4,2]),option([1])], prompt => {
        assert.doesNotMatch(prompt, /비공개성함|다른 증상|비공개장소|연락처/);
        assert.match(prompt, /"targets":\["피로"\]/);
      }));
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.recommendations.map(r => [r.rank,r.formula]), [[1,'라탕 + 나탕'], [2,'육가탕']]);
    assert.equal(result.recommendations[0].references.length, 2);
    assert.deepEqual(result.recommendations[0].references[0], {title: entries[3].title, excerpt: entries[3].indication, url: entries[3].url});
    assert.match(result.recommendations[0].useHistory, /개별 사용 기록 있음/);
    assert.equal(result.recommendations[1].combinationRationale, '');
  }
});

test('rejects previously co-used pairs even from larger groups and repeated fixed-product alternatives', async () => {
  const rows = [header, row('라탕 + 다탕 + 마탕')];
  const result = await recommendFromGuide(rows, catalog, ['피로'], entries, 'gemini-4-argon',
    generateMock([option([3,5]),option([6]),option([1,2])]));
  assert.deepEqual(result.recommendations.map(r => r.formula), ['가나합방']);
});

test('does not invent candidates for unrecognized history, empty sources, provider failure or invented reference IDs', async () => {
  const failed = async () => { throw Error('unavailable'); };
  const model = 'gpt-6.2-astra';
  for (const response of [
    await recommendFromGuide([header,row('???')], catalog, ['피로'], entries, model, failed),
    await recommendFromGuide([header], catalog, ['피로'], [], model, failed),
    await recommendFromGuide([header], catalog, ['피로'], entries, model, failed),
    await recommendFromGuide([header], catalog, ['피로'], entries, model, generateMock([option([9999])])),
  ]) {
    assert.equal(response.status, 'unavailable');
    assert.deepEqual(response.recommendations, []);
  }
  assert.equal((await recommendFromGuide([header], catalog, ['피로'], entries, model, generateMock([]))).status, 'no_matches');
});
