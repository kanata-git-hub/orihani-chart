import test from 'node:test';
import assert from 'node:assert/strict';
import { guideUseHistory, recommendFromGuide as recommendWithHistory } from '../guideSuggestions.ts';
import type { GuideEntry } from '../guideSuggestions.ts';
import type { SheetRows } from '../prescriptionRecipe.ts';
import type { generateFollowUpResponse } from '../followUpEngine.ts';
import type { BookCorpus } from '../bookGuide.ts';
import { selectBookPages } from '../bookGuide.ts';

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
    assert.equal(result.recommendations[0].conditionSummary, [entries[3].indication, entries[1].indication].join(' / '));
    assert.match(result.shortlistNote!, /제외해 2개/);
    assert.match(result.recommendations[0].useHistory, /개별 사용 기록 있음/);
    assert.equal(result.recommendations[1].combinationRationale, '');
  }
});

test('collapsed conditions quote the selected product, fall back on unsupported model text and preserve the pairing', async () => {
  const products = entries.map((entry, i) => ({...entry, indication: '다른 용도도 있다. ' + entry.name + '의 피로 동반 조건 ' + i + '번.'}));
  const result = await recommendFromGuide([header], catalog, ['피로'], products, 'gpt-6.2-astra', generateMock([
    {...option([1, 2]), conditionPhrases: ['육가탕의 피로 동반 조건', '자료에 없는 진단']},
    {...option([3]), conditionPhrases: ['나탕의 피로 동반 조건']},
  ]));
  assert.deepEqual(result.recommendations.map(item => item.conditionSummary), [
    '육가탕의 피로 동반 조건 / 나탕의 피로 동반 조건 1번.', '다탕의 피로 동반 조건 2번.',
  ]);
  assert.match(result.shortlistNote!, /2개/);
});

test('shortening the guide preview cannot turn a negated condition into a positive cue', async () => {
  const products = [{...entries[0], indication: '다른 용도. 체력이 중간이고 심하게 쇠약하지 않은 사람의 증상.'}];
  const result = await recommendFromGuide([header], catalog, ['피로'], products, 'gemini-4-argon',
    generateMock([{...option([1]), conditionPhrases: ['심하게 쇠약']}]));
  assert.equal(result.recommendations[0].conditionSummary, '체력이 중간이고 심하게 쇠약하지 않은 사람의 증상.');
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

const books: BookCorpus = {pages:[
  {id:'p11', book:'시험 도서', section:'문진', page:11, topics:'작업 후 불편 소견', text:'가상의 작업 불편은 특성 가를 확인해 구분한다.'},
  {id:'p23', book:'시험 도서', section:'해설', page:23, topics:'가상 처방 가 해설', text:'특성 가가 함께 확인될 때 육가탕을 검토한다.'},
  {id:'p30', book:'시험 도서', section:'표', page:30, topics:'다른 표현을 쓰는 분류', text:'작업 불편에 가나합방을 고려한다.'},
]};
const bookOption = {...option([1]), conditionPhrases:[], conditionSummary:'작업 때 나타나는 특성 가 확인',
  evidenceKind:'book_pattern', citations:[
    {pageId:'p11', quote:'작업 불편은 특성 가를 확인해 구분한다.'},
    {pageId:'p23', quote:'특성 가가 함께 확인될 때 육가탕을 검토한다.'},
  ]};
const bookMock = (options:unknown[], model:'gpt-6.2-astra'|'gemini-4-argon'): typeof generateFollowUpResponse =>
  async (prompt,engine,config) => {
    assert.equal(config.exactSearchModel, model);
    assert.equal(engine, model === 'gpt-6.2-astra' ? 'gpt-astra' : 'gemini');
    assert.doesNotMatch(String(prompt), /비공개성함|비공개장소/);
    if (String(prompt).includes('"index":')) {
      assert.match(String(prompt), /작업 후 불편 소견/);
      assert.doesNotMatch(String(prompt), /특성 가가 함께 확인될 때 육가탕/);
      return {text:JSON.stringify({pageIds:['p11'],searchTerms:['특성 가','가나합방']}), engine, model};
    }
    assert.match(String(prompt), /특성 가가 함께 확인될 때 육가탕/);
    return {text:JSON.stringify({options}),engine,model};
  };

test('selected provider uses page topics to interpret paraphrases and returns verified conditional links from two passages', async () => {
  const history = guideUseHistory([header,row('나탕')],catalog,entries);
  for (const model of ['gemini-4-argon','gpt-6.2-astra'] as const) {
    const result = await recommendWithHistory(history,['하루 종일 일하면 이상해요'],entries,model,bookMock([bookOption],model),books);
    assert.equal(result.status,'ok');
    const candidate = result.recommendations[0];
    assert.equal(candidate.evidenceKind,'book_pattern');
    assert.equal(candidate.conditionSummary,bookOption.conditionSummary);
    assert.deepEqual(candidate.bookReferences?.map(item => [item.book,item.page]),[['시험 도서',11],['시험 도서',23]]);
    assert.equal(candidate.references[0].title,entries[0].title);
  }
});

test('a book citation must be retrievable verbatim and identify each formula, not merely one containing a similar name', async () => {
  const extended = [...entries, {...entries[0],number:'7',name:'육가탕합방'}];
  const augmented = {pages:[...books.pages,{id:'p24',book:'시험 도서',section:'해설',page:24,text:'특성 가가 있으면 육가탕합방을 선택한다.'}]};
  const invalid = [
    {...bookOption,citations:[{pageId:'p23',quote:'육가탕을 반드시 사용한다.'}]},
    {...bookOption,citations:[bookOption.citations[1]]},
    {...bookOption,evidenceKind:'book_direct',citations:[{pageId:'p24',quote:'육가탕합방을 선택한다.'}]},
    {...bookOption,ids:[1,2]},
  ];
  for (const candidate of invalid) {
    const result = await recommendWithHistory(guideUseHistory([header],catalog,extended),['작업 불편'],extended,'gemini-4-argon',
      bookMock([candidate],'gemini-4-argon'),augmented);
    assert.equal(result.status,'unavailable');
    assert.deepEqual(result.recommendations,[]);
  }
});

test('grounded but already-used book candidate is distinguished from lack of supporting passages', async () => {
  const history = guideUseHistory([header,row('육가탕')],catalog,entries);
  const ask = (options: unknown[]) => recommendWithHistory(history,['작업 불편'],entries,'gemini-4-argon',
    bookMock(options,'gemini-4-argon'),books);
  assert.match((await ask([bookOption])).message,/사용 이력과 겹쳐/);
  assert.match((await ask([])).message,/근거를 찾지 못/);
});

test('bounded semantic lookup can reach a chapter outside its first pass and includes the continuation', async () => {
  const pages = Array.from({length:476}, (_, index) => ({
    id:'P' + index, page:index + 1, book:'시험 도서', section:'질환별', topics:'기타 항목',
    text:'다양한 일반적인 항목과 특성. 다른 내용이다.',
  }));
  pages[439].text = '질환별\n전문 표현\n자료 본문에 나오는 조건.';
  const generate: typeof generateFollowUpResponse = async (prompt,engine) => {
    const {index} = JSON.parse(String(prompt).split('\n').at(-1)!);
    assert.ok(index.length <= 30);
    assert.ok(index.every((row: string[]) => row[0] !== 'P439'));
    return {text:JSON.stringify({pageIds:[],searchTerms:['전문 표현']}),engine:String(engine),model:'gemini-4-argon'};
  };
  const selected = await selectBookPages({pages},['모델이 풀어쓸 일상적인 문장'],'gemini-4-argon',generate);
  assert.equal(selected[0].id,'P439');
  assert.ok(selected.some(page => page.id === 'P440'));
  assert.ok(selected.length <= 18);
});
