import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicalEvidence, componentEvidence } from '../prescriptionSearch.ts';

const headers=['성함','증상','처방','처방2','처방3','효과','효과(자세히)'];
const catalog=[['처방명'],['가처방'],['나처방'],['다처방'],['라처방'],['단독+제품']];
const row=(symptoms:string, formulas:string[], grade:string, detail='')=>[
  '가상환자',symptoms,formulas[0]??'',formulas[1]??'',formulas[2]??'',grade,detail,
];
const grades=(good:number,neutral:number,bad:number)=>({total:good+neutral+bad,good,neutral,bad});

test('common components retain all V outcomes, excluded records and exact with/without-partner comparators',()=>{
  const clinic=clinicalEvidence([headers,
    row('소화불량',['가처방'],'보통'),
    row('소화불량',['가처방','나처방'],'좋음'),
    row('소화불량',['나처방','가처방'],'나쁨','소화불량 악화됨'),
    row('소화불량',['가처방','다처방'],'좋음'),
    row('소화불량',['가처방','나처방','다처방'],'좋음'),
    row('소화불량',['라처방'],'나쁨'),
    row('소화불량',['단독+제품'],'좋음'),
    ...['','종결','미정'].map(grade=>row('소화불량',['가처방','라처방'],grade,'소화불량 완전히 호전됨')),
  ],catalog,'소화불량');
  const all=componentEvidence(clinic);
  const a=all.find(component=>component.formula==='가처방')!;
  assert.deepEqual(a.included,grades(3,1,1));
  assert.deepEqual(a.absent,grades(1,0,1));
  assert.deepEqual(a.solo,grades(0,1,0));
  assert.deepEqual(a.combined,grades(3,0,1));
  assert.equal(a.groupIds.length,4);
  const partner=a.partners.find(p=>p.formula==='나처방')!;
  assert.deepEqual(partner.withPartner,grades(2,0,1));
  assert.deepEqual(partner.withoutPartner,grades(1,1,0));
  const formulas=(id:number)=>clinic.groups[id-1].components;
  assert.deepEqual(partner.matched.map(pair=>[formulas(pair.baseGroupId),formulas(pair.addedGroupId)]),[
    [['가처방'],['가처방','나처방']], [['가처방','다처방'],['가처방','나처방','다처방']],
  ]);
  assert.deepEqual(all.find(component=>component.formula==='나처방')!.solo,grades(0,0,0));
  assert.deepEqual(all.find(component=>component.formula==='단독+제품')!.solo,grades(1,0,0));
  assert(!all.some(component=>component.formula==='단독'||component.formula==='제품'));
  assert.deepEqual(clinic.excluded,{미정:1,종결:1,결과미기록:1,기타:0});
});

test('multi-target matches preserve individual goals, co-symptoms, V and W attribution without emitting raw chart descriptions',()=>{
  const symptoms='소화불량, 피로, 어지럼, 월경통, 입마름 없음, 수면 양호, 비공개장소 99길';
  const w='소화불량은 조금 호전됨. 피로는 악화됨. 가상환자 010-0123-4567.';
  const rows=[headers,
    row(symptoms,['가처방','나처방'],'보통',w),row(symptoms,['나처방','가처방'],'보통',w),
    row('피로, 불면',['가처방'],'좋음'),row('두통',['라처방'],'좋음'),
    row('소화불량',['라처방'],'나쁨','어지럼 호전됨'),
    row('소화불량 없음, 피로(-), 월경통',['라처방'],'좋음'),
  ];
  const clinic=clinicalEvidence(rows,catalog,'소화불량, 피로');
  assert.deepEqual(clinic.targets,['소화불량','피로']);
  const combination=clinic.groups.find(g=>g.components.length===2)!;
  const [context]=combination.contexts;
  assert.equal(combination.기록,2);
  assert.equal(combination.contexts.length,1);
  assert.equal(context.count,2);
  assert.deepEqual(context.targets,['소화불량','피로']);
  assert.deepEqual(context.coSymptoms,['어지럼','월경통']);
  assert.equal(context.grade,'보통');
  assert(context.feedback.some(f=>f.대상==='검색 증상: 소화불량'&&f.경과==='호전'));
  assert(context.feedback.some(f=>f.대상==='검색 증상: 피로'&&f.경과==='악화'));
  const solo=clinic.groups.find(g=>g.formula==='가처방')!.contexts[0];
  assert.deepEqual(solo.targets,['피로']);
  assert.deepEqual(solo.coSymptoms,['불면']);
  assert.equal(solo.grade,'좋음');
  assert.equal(solo.detailStatus,'미작성');
  assert.deepEqual(solo.feedback,[]);
  assert.deepEqual(clinic.groups.find(g=>g.formula==='라처방')!.contexts[0].targets,['소화불량']);
  assert.equal(clinic.groups.reduce((total,g)=>total+g.기록,0),4);
  assert.doesNotMatch(JSON.stringify(clinic),/비공개장소|99길|가상환자|010-0123/);
  for (const query of ['소화불량 + 피로','소화불량 / 피로','소화불량, 피로, 피로']) {
    assert.deepEqual(clinicalEvidence(rows,catalog,query),clinic);
  }
  assert.throws(()=>clinicalEvidence(rows,catalog,'피로, 가상환자'));
});

test('compares background use with separate denominators and retains only aggregate data for other targets',()=>{
  const clinic=clinicalEvidence([headers,
    row('피로',['가처방'],'좋음'),
    row('피로',['가처방','나처방'],'보통','피로는 호전됨. 피로는 다시 심해짐.'),
    row('피로',['나처방'],'나쁨'),
    row('두통',['가처방'],'좋음','개인정보가 든 문장'),
    row('두통',['가처방','나처방'],'보통'),
    row('요통',['다처방'],'좋음'),
    row('',['가처방'],'좋음'),
    row('요통',['미등록'],'좋음'),
    ...['','미정','종결'].map(grade=>row('요통',['가처방'],grade)),
  ],catalog,'피로');
  const base=componentEvidence(clinic).find(c=>c.formula==='가처방')!;
  assert.deepEqual(base.included,grades(1,1,0));
  assert.deepEqual(base.absent,grades(0,0,1));
  assert.deepEqual(base.otherTargets,{included:grades(1,1,0),absent:grades(1,0,0)});
  assert.equal(base.targetImproved,1);
  assert.equal(base.targetCaution,1);
  assert.deepEqual(clinic.excluded,{미정:0,종결:0,결과미기록:0,기타:0});
  assert.equal(clinic.skipped,0);
  assert.doesNotMatch(JSON.stringify([clinic,base]),/개인정보가 든 문장|요통|미등록|다처방|가상환자/);
});

test('a change to a query term not among this row’s targets is not counted as target relief',()=>{
  const clinic=clinicalEvidence([headers,row('피로',['가처방'],'보통','소화불량이 좋아짐')],
    catalog,'피로, 소화불량');
  assert.equal(clinic.groups[0].targetImproved,0);
  assert.deepEqual(clinic.groups[0].contexts[0].targets,['피로']);
  assert.equal(clinic.groups[0].contexts[0].feedback[0].대상,'동반·기타: 소화불량');
});
