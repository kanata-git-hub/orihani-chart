import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPrescriptionPatients, getLatestPrescriptionPatient, calculatePrescriptionRecipe, createPrescriptionRecipe, RecipeError } from '../prescriptionRecipe.ts';
import type { SheetRows } from '../prescriptionRecipe.ts';

const header = ['성함', '번호', '나이', '성별', '상태', '현재/총기간', '결제일', '배송일', '1차 문자발송', '1차', '2차 문자발송', '2차', '증상', '처방', '처방2', '처방3', '가', '감', '처방 조합'];
const row = (number: string, name: string, date: string, symptoms: string, formula = '테스트처방가', gender = '여'): unknown[] => [name, number, '40', gender, '', '', date, '', '', '', '', '', symptoms, formula];
const herbRows: SheetRows = [
  ['번호', '처방명', '약재명', '함량'],
  [1, '테스트처방가', '약재가', 2], [1, '테스트처방가', '약재나', 0.29],
  [2, '테스트처방나', '약재가', 4], [2, '테스트처방나', '약재다', 1.5],
];

test('same-name patients stay separate by chart number; optional gender and symptoms narrow candidates', () => {
  const rows = [header, row('101', '테스트환자', '2026. 10. 01', '소화 불편'), row('102', '테스트환자', '2026. 10. 02', '수면 불편', undefined, '남')];
  assert.equal(searchPrescriptionPatients(rows, { name: '테스트환자' }).length, 2);
  assert.equal(searchPrescriptionPatients(rows, { name: '테스트환자', gender: '여' })[0].chartNumber, '101');
  assert.equal(searchPrescriptionPatients(rows, { name: '테스트', symptoms: '수면' })[0].chartNumber, '102');
});

test('historical symptom finds patient but latest undelivered prescription comes from entire history', () => {
  const older = row('101', '테스트환자', '2026. 9. 1', '두통'); older[7] = '2026. 9. 3';
  const newer = row('101', '테스트환자', '2026. 10. 30', '소화 불편', '테스트처방나');
  const [patient] = searchPrescriptionPatients([header, older, newer], { name: '테스트환자', symptoms: '두통' });
  assert.equal(patient.rowNumber, 3);
  assert.deepEqual(patient.formulas, ['테스트처방나']);
  assert.equal(patient.dateLabel, '결제일');
  assert.equal(patient.recordCount, 2);
});

test('equal or absent dates use bottom row, and blank chart numbers never merge', () => {
  const rows = [header, row('', '동명환자', '', '가'), row('', '동명환자', '', '나'), row('103', '날짜환자', '2026-10-30', '가'), row('103', '날짜환자', '2026-10-30', '나')];
  const patients = searchPrescriptionPatients(rows, { name: '동명환자' });
  assert.deepEqual(patients.map(p => p.rowNumber), [3, 2]);
  assert.notEqual(patients[0].id, patients[1].id);
  assert.equal(getLatestPrescriptionPatient(rows, 'chart:103').rowNumber, 5);
});

test('delivery date is fallback; malformed calendar dates are not accepted as newer', () => {
  const delivered = row('101', '테스트환자', '', '가'); delivered[7] = '2026-10-29';
  const invalid = row('101', '테스트환자', '2026-02-31', '나');
  const patient = getLatestPrescriptionPatient([header, delivered, invalid], 'chart:101');
  assert.equal(patient.rowNumber, 2);
  assert.equal(patient.dateLabel, '배송일');
});

test('max duplicate grams across formulas; exact source names and fractional daily grams survive', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가'); patientRow[14] = '테스트처방나';
  const result = createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101');
  assert.deepEqual(result.herbs, [{ name: '약재가', dailyGrams: 4 }, { name: '약재나', dailyGrams: 0.29 }, { name: '약재다', dailyGrams: 1.5 }]);
  assert.equal(Number((result.herbs[1].dailyGrams * 7).toFixed(2)), 2.03);
});

test('latest empty prescription blocks calculation instead of silently substituting an old one', () => {
  const rows = [header, row('101', '테스트환자', '2026-10-01', '가'), row('101', '테스트환자', '2026-10-30', '나', '')];
  assert.throws(() => createPrescriptionRecipe(rows, herbRows, 'chart:101'), /가장 최근 기록에 처방이 없습니다/);
});

test('missing formulas, malformed quantities and duplicate catalog rows fail without partial recipes', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가'); patientRow[14] = '없는처방';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /찾지 못했습니다/);
  patientRow[14] = '';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], [...herbRows, [1, '테스트처방가', '약재가', 2]], 'chart:101'), /중복 등록/);
  assert.throws(() => createPrescriptionRecipe([header, patientRow], [herbRows[0], [1, '테스트처방가', '약재가', '약 2']], 'chart:101'), /함량/);
});

test('explicit herb additions add grams and plain herb removals remove the herb', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가');
  patientRow[16] = '약재가 +1g, 약재다 0.5g'; patientRow[17] = '약재나';
  const result = createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101');
  assert.deepEqual(result.herbs, [{ name: '약재가', dailyGrams: 3 }, { name: '약재다', dailyGrams: 0.5 }]);
  assert.equal(result.warnings.length, 2);
});

test('unsupported ratios, unknown additions and ambiguous combination text block calculation', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가');
  patientRow[17] = '약재가 절반';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /남길 비율/);
  patientRow[17] = ''; patientRow[16] = '미등록약재 2g';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /약재 시트에서 찾지/);
  patientRow[16] = ''; patientRow[18] = '테스트처방가 (1/2)';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /처방 조합/);
});

test('only-combination rows work and normalized headers tolerate spaces/newlines', () => {
  const customHeader = header.map(h => h === '처방 조합' ? '처방\n조합' : h === '결제일' ? '결제\n일' : h);
  const patientRow = row('101', '테스트환자', '2026. 10. 30', '가', ''); patientRow[18] = '테스트처방가 + 테스트처방나';
  assert.equal(createPrescriptionRecipe([customHeader, patientRow], herbRows, 'chart:101').herbs.length, 3);
});

test('empty searches and nonexistent patient ids are rejected', () => {
  assert.throws(() => searchPrescriptionPatients([header], { name: ' ' }), (error: unknown) => error instanceof RecipeError && error.status === 400);
  assert.throws(() => getLatestPrescriptionPatient([header], 'chart:101'), (error: unknown) => error instanceof RecipeError && error.status === 404);
});

test('numberless selection is invalidated when its sheet row changes', () => {
  const rows = [header, row('', '테스트환자', '', '가')];
  const [patient] = searchPrescriptionPatients(rows, { name: '테스트환자' });
  rows[1] = row('', '다른환자', '', '가');
  assert.throws(() => getLatestPrescriptionPatient(rows, patient.id), /다시 검색/);
});

test('matching explicit trailing combination modifiers calculate once and do not duplicate display', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가');
  patientRow[16] = '약재가 1g 추가'; patientRow[17] = '약재나';
  patientRow[18] = '테스트처방가 (가: 약재가 1g 추가, 감: 약재나)';
  const result = createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101');
  assert.deepEqual(result.herbs, [{ name: '약재가', dailyGrams: 3 }]);
  assert.equal(result.patient.prescription, patientRow[18]);
  patientRow[16] = ''; patientRow[18] = '테스트처방가 (감: 약재나)';
  assert.deepEqual(createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101').herbs, [{ name: '약재가', dailyGrams: 2 }]);
});

test('combination notes that disagree with separate modifier columns are rejected', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가');
  patientRow[17] = '약재나'; patientRow[18] = '테스트처방가 (감: 약재가)';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /처방 조합/);
  patientRow[17] = ''; patientRow[18] = '테스트처방가 (감: 약재나)';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /처방 조합/);
});

test('herb fractions retain the indicated ratio; invalid ratios are rejected', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가');
  patientRow[17] = '약재가 1/2';
  assert.deepEqual(createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101').herbs, [{ name: '약재가', dailyGrams: 1 }, { name: '약재나', dailyGrams: 0.29 }]);
  for (const invalid of ['약재가 1/0', '약재가 3/2']) {
    patientRow[17] = invalid;
    assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /남길 비율은/);
  }
  for (const duplicate of ['약재가 1/2, 약재가 1/2', '약재가 1/2, 약재가']) {
    patientRow[17] = duplicate;
    assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /중복/);
  }
});

test('ambiguous addition to an existing herb is blocked, while an explicit extra amount works', () => {
  const patientRow = row('101', '테스트환자', '2026-10-30', '가'); patientRow[16] = '약재가 1g';
  assert.throws(() => createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101'), /추가량인지 최종량인지/);
  patientRow[16] = '약재가 1g 추가';
  assert.equal(createPrescriptionRecipe([header, patientRow], herbRows, 'chart:101').herbs[0].dailyGrams, 3);
});

const ephedraRows: SheetRows = [
  ['번호', '처방명', '약재명', '함량'],
  [1, '테스트처방가', '약재가', 2],
  [1, '테스트처방가', '마황', 3],
  [2, '테스트처방나', '약재나', 1],
  [3, '테스트처방다', '마황 고용량', 6],
  [4, '테스트처방라', '후박', 2],
  [4, '테스트처방라', '소엽', 2],
];
const ephedraPatient = (addition = '', removal = '', formula = '테스트처방가') => {
  const patientRow = row('901', '가상환자', '2026-10-31', '가상증상', formula);
  patientRow[16] = addition;
  patientRow[17] = removal;
  return patientRow;
};

test('parenthesized ephedra is final per-pack target times two, with exact course quantities', () => {
  for (const [input, expectedName, daily, totals] of [
    ['마황(5g)', '마황', 10, [10, 70, 150, 300]],
    ['마황(6g)', '마황', 12, [12, 84, 180, 360]],
    ['마황(2.5g)', '마황', 5, [5, 35, 75, 150]],
    ['마황 고용량(2.5g)', '마황 고용량', 5, [5, 35, 75, 150]],
  ] as const) {
    const result = createPrescriptionRecipe([header, ephedraPatient(input)], ephedraRows, 'chart:901');
    const ephedra = result.herbs.filter(herb => herb.name.startsWith('마황'));
    assert.deepEqual(ephedra, [{ name: expectedName, dailyGrams: daily }]);
    assert.deepEqual([1, 7, 15, 30].map(days => ephedra[0].dailyGrams * days), totals);
    assert.equal(result.herbs.find(herb => herb.name === '약재가')?.dailyGrams, 2);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /g\/팩 × 2팩 = .*g\/일을 최종량/);
    assert.doesNotMatch(result.warnings[0], /용량에 추가/);
  }
});

test('per-pack targets normalize whitespace, fullwidth punctuation and uppercase gram unit', () => {
  for (const input of [' 마황 ( 5 G ) ', '마황（５ｇ）', '마 황 (5g)', '마황\t( 5g )', '마황(5그램)']) {
    const result = createPrescriptionRecipe([header, ephedraPatient(input)], ephedraRows, 'chart:901');
    assert.deepEqual(result.herbs.find(herb => herb.name === '마황'), { name: '마황', dailyGrams: 10 });
  }
  const result = createPrescriptionRecipe([header, ephedraPatient(' 마황  고용량 （ 2.5 G ） ')], ephedraRows, 'chart:901');
  assert.deepEqual(result.herbs.find(herb => herb.name.startsWith('마황')), { name: '마황 고용량', dailyGrams: 5 });
});

test('ephedra aliases share a base key and target overwrite, including the 감 column', () => {
  const patientRow = ephedraPatient('', '마황 고용량(2.5g)');
  patientRow[14] = '테스트처방다';
  const result = createPrescriptionRecipe([header, patientRow], ephedraRows, 'chart:901');
  assert.deepEqual(result.herbs.filter(herb => herb.name.startsWith('마황')), [{ name: '마황 고용량', dailyGrams: 5 }]);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0], '마황 고용량: 2.5g/팩 × 2팩 = 5g/일을 최종량으로 적용했습니다.');
  const ordinary = createPrescriptionRecipe([header, ephedraPatient('마황(5g)', '', '테스트처방다')], ephedraRows, 'chart:901');
  assert.deepEqual(ordinary.herbs, [{ name: '마황', dailyGrams: 10 }]);
});

test('가 per-pack target can introduce catalog ephedra, while 감 cannot introduce an absent herb', () => {
  const result = createPrescriptionRecipe([header, ephedraPatient('마황 고용량(2.5g)', '', '테스트처방나')], ephedraRows, 'chart:901');
  assert.deepEqual(result.herbs, [{ name: '약재나', dailyGrams: 1 }, { name: '마황 고용량', dailyGrams: 5 }]);
  assert.throws(() => createPrescriptionRecipe([header, ephedraPatient('', '마황(5g)', '테스트처방나')], ephedraRows, 'chart:901'), /현재 처방에 없습니다/);
});

test('duplicate ephedra alias directives never merge or apply last-wins across 가 and 감', () => {
  for (const [addition, removal] of [
    ['마황(5g), 마황 고용량(2.5g)', ''],
    ['', '마황(5g), 마황 고용량(2.5g)'],
    ['마황(5g)', '마황 고용량(2.5g)'],
    ['마황(5g)', '마황'],
    ['마황(5g), 마황 +2g', ''],
    ['마황 +2g, 마황 고용량(2.5g)', ''],
    ['', '마황 1/2, 마황 고용량(2.5g)'],
  ]) {
    assert.throws(() => createPrescriptionRecipe([header, ephedraPatient(addition, removal)], ephedraRows, 'chart:901'), /마황 지시.*중복/);
  }
  const duplicateCatalog = [...ephedraRows, [1, '테스트처방가', '마황 고용량', 2]];
  assert.throws(() => createPrescriptionRecipe([header, ephedraPatient('마황(5g)')], duplicateCatalog, 'chart:901'), /중복 등록/);
});

test('malformed, nonpositive or unitless ephedra pack targets block with named errors', () => {
  for (const input of ['마황(-5g)', '마황(0g)', '마황(5)', '마황(5mg)', '마황(2.5.5g)', '마황(g)', '마황(+5g)', '마황(5g) 추가', '마황 고용량(0g)']) {
    for (const column of ['가', '감']) {
      const patientRow = ephedraPatient(column === '가' ? input : '', column === '감' ? input : '');
      assert.throws(() => createPrescriptionRecipe([header, patientRow], ephedraRows, 'chart:901'), (error: unknown) => error instanceof RecipeError && error.status === 422 && /마황/.test(error.message));
    }
  }
});

test('undosed general herbs in a mixed entry still block and name the offending herb', () => {
  for (const input of ['후박, 소엽, 마황(5g)', '마황(5g), 후박', '후박 2g, 소엽, 마황 고용량(2.5g)']) {
    const expectedHerb = input.startsWith('후박 2g') ? '소엽' : '후박';
    assert.throws(() => createPrescriptionRecipe([header, ephedraPatient(input)], ephedraRows, 'chart:901'), (error: unknown) => error instanceof RecipeError && error.message.includes(expectedHerb) && /용량이 없거나/.test(error.message));
  }
  assert.throws(() => createPrescriptionRecipe([header, ephedraPatient('후박(2g), 마황(5g)')], ephedraRows, 'chart:901'), /후박/);
});

test('plain additions remain daily and mixed warnings distinguish daily amounts from pack targets', () => {
  const result = createPrescriptionRecipe([header, ephedraPatient('후박 2g, 소엽 1g, 마황(5g)')], ephedraRows, 'chart:901');
  assert.equal(result.herbs.find(herb => herb.name === '후박')?.dailyGrams, 2);
  assert.equal(result.herbs.find(herb => herb.name === '소엽')?.dailyGrams, 1);
  assert.equal(result.herbs.find(herb => herb.name === '마황')?.dailyGrams, 10);
  assert.deepEqual(result.warnings, ['마황: 5g/팩 × 2팩 = 10g/일을 최종량으로 적용했습니다.', '일반 가: 표기된 g만큼 1일 용량에 추가했습니다.']);
  const plainNew = createPrescriptionRecipe([header, ephedraPatient('마황 5g', '', '테스트처방나')], ephedraRows, 'chart:901');
  assert.equal(plainNew.herbs.find(herb => herb.name === '마황')?.dailyGrams, 5);
  const plainExtra = createPrescriptionRecipe([header, ephedraPatient('마황 +2g')], ephedraRows, 'chart:901');
  assert.equal(plainExtra.herbs.find(herb => herb.name === '마황')?.dailyGrams, 5);
  assert.throws(() => createPrescriptionRecipe([header, ephedraPatient('마황 5g')], ephedraRows, 'chart:901'), /추가량인지 최종량인지/);
});

test('bare ephedra removal and N/D retention preserve existing behavior with the high-dose alias', () => {
  const removed = createPrescriptionRecipe([header, ephedraPatient('', '마황 고용량')], ephedraRows, 'chart:901');
  assert.deepEqual(removed.herbs, [{ name: '약재가', dailyGrams: 2 }]);
  const retained = createPrescriptionRecipe([header, ephedraPatient('', '마황 고용량 1/2')], ephedraRows, 'chart:901');
  assert.equal(retained.herbs.find(herb => herb.name === '마황')?.dailyGrams, 1.5);
});

test('ordinary daily ephedra addition then fraction or full removal retains previous cross-column behavior', () => {
  const retained = createPrescriptionRecipe([header, ephedraPatient('마황 +2g', '마황 1/2')], ephedraRows, 'chart:901');
  assert.deepEqual(retained.herbs, [{ name: '약재가', dailyGrams: 2 }, { name: '마황', dailyGrams: 2.5 }]);
  const removed = createPrescriptionRecipe([header, ephedraPatient('마황 +2g', '마황')], ephedraRows, 'chart:901');
  assert.deepEqual(removed.herbs, [{ name: '약재가', dailyGrams: 2 }]);
  for (const [addition, removal] of [['마황 +2g, 마황 고용량 +1g', ''], ['', '마황 1/2, 마황 고용량 1/2']]) {
    assert.throws(() => createPrescriptionRecipe([header, ephedraPatient(addition, removal)], ephedraRows, 'chart:901'), /중복/);
  }
});

test('nested combined modifiers match separate columns and display only once', () => {
  const patientRow = ephedraPatient('마황(5g)', '약재가');
  patientRow[18] = '테스트처방가 (가: 마황(5g), 감: 약재가)';
  const result = createPrescriptionRecipe([header, patientRow], ephedraRows, 'chart:901');
  assert.deepEqual(result.herbs, [{ name: '마황', dailyGrams: 10 }]);
  assert.equal(result.patient.prescription, patientRow[18]);
  patientRow[18] = '테스트처방가 （가： 마황（5G）） （감： 약재가）';
  assert.deepEqual(createPrescriptionRecipe([header, patientRow], ephedraRows, 'chart:901').herbs, result.herbs);
  patientRow[13] = '';
  assert.deepEqual(createPrescriptionRecipe([header, patientRow], ephedraRows, 'chart:901').patient.formulas, ['테스트처방가']);
});

test('nested combined mismatches, unbalanced groups and unsupported instructions remain blocked', () => {
  const patientRow = ephedraPatient('마황(5g)');
  for (const combined of [
    '테스트처방가 (가: 마황(2.5g))',
    '테스트처방가 (가: 마황(5g)) (가: 마황(5g))',
    '테스트처방가 (가: 마황(5g)) 추가 지시',
    '테스트처방가 (가: 마황(5g)',
    '테스트처방가 (가: 마황(5g)))',
    '테스트처방가 (절반) (가: 마황(5g))',
  ]) {
    patientRow[18] = combined;
    assert.throws(() => createPrescriptionRecipe([header, patientRow], ephedraRows, 'chart:901'), /처방 조합/);
  }
});
