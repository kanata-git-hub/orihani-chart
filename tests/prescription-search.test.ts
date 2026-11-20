import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalEvidence, componentEvidence} from '../prescriptionSearch.ts';
import {generateFollowUpResponse} from '../followUpEngine.ts';
import {recommendPrescriptions} from '../prescriptionRecommendations.ts';

const catalog=[['처방명'],['가처방'],['나처방']];
const headers=['성함','증상','처방','처방2','효과','효과(자세히)'];
const sample=(v:string,w:string,formula='가처방',second='')=>['합성이름','피로, 두통',formula,second,v,w];
const summarize=(...rows:string[][])=>clinicalEvidence([headers,...rows],catalog,'피로');

function commonBaseFixture() {
  const formulas = ['기본탕','보조탕','대안탕','빈용탕','비교탕','반례탕','미전달탕'];
  const directory = [['처방명'], ...formulas.map(name=>[name])];
  const record = (targets:string, first:string, second:string, grade:string, feedback='') =>
    ['합성이름',targets,first,second,grade,feedback];
  const rows = [
    headers,
    ...Array.from({length:5}, () => record('소화불량, 두통','빈용탕','비교탕','좋음','두통이 좋아짐')),
    record('소화불량, 두통','기본탕','보조탕','좋음','소화불량이 조금 좋아짐'),
    record('소화불량','기본탕','대안탕','좋음'),
    record('소화불량, 두통','기본탕','대안탕','나쁨','소화불량 악화됨. 합성이름 010-1234-5678'),
    record('소화불량, 기침','반례탕','','보통','기침은 그대로'),
    record('소화불량','미전달탕','','','소화불량 호전됨'),
  ];
  return clinicalEvidence(rows,directory,'소화불량');
}

function synthesisExample() {
  const clinic = commonBaseFixture();
  const components = componentEvidence(clinic);
  const componentId = (name:string) => {
    const id = 1 + components.findIndex(item=>item.formula===name);
    assert(id > 0);
    return id;
  };
  const groupId = (...names:string[]) => {
    const id = 1 + clinic.groups.findIndex(group=>
      group.components.length===names.length && names.every(name=>group.components.includes(name)));
    assert(id > 0);
    return id;
  };
  const baseWithPartner = groupId('기본탕','보조탕');
  const baseWithAlternative = groupId('기본탕','대안탕');
  const choice = {
    baseId:componentId('기본탕'),
    reason:'서로 다른 두 합방에 반복됐고 소화불량 호전 기록이 있습니다.',
    limitation:'단독 사용 사례가 없고 다른 조합에서는 악화도 기록됐습니다.',
    guidance:'',
    groupIds:[baseWithPartner,baseWithAlternative],
    additions:[{
      componentIds:[componentId('보조탕')],
      when:'두통을 함께 호소하는 경우',
      why:'두 증상이 함께 있던 합방에서 소화불량 호전이 기록돼 함께 쓸 후보입니다.',
      groupIds:[baseWithPartner],
    }],
  };
  return {clinic,choice,componentId,groupId};
}

test('both selected models can infer a recurring base over a more frequent exact regimen with auditable, conditional add-ons', async () => {
  const {clinic,choice} = synthesisExample();
  for (const model of ['gpt-6.2-astra','gemini-4-argon'] as const) {
    const result = await recommendPrescriptions(clinic,'소화불량',model,async(prompt,engine,options)=>{
      assert.equal(options.exactSearchModel,model);
      assert.equal(engine,model==='gpt-6.2-astra' ? 'gpt-astra' : 'gemini');
      const input=String(prompt);
      assert.match(input,/쯔무라/);
      assert.doesNotMatch(input,/합성이름|010-1234-5678|미전달탕/);
      const dataLine=input.split('\n').find(line=>{
        try { const parsed=JSON.parse(line); return Array.isArray(parsed.groups) && Array.isArray(parsed.components); }
        catch { return false; }
      });
      assert(dataLine,'Model receives structured sheet evidence');
      const payload=JSON.parse(dataLine);
      assert.deepEqual(payload.targets,['소화불량']);
      assert.equal(payload.groups.length,clinic.groups.length);
      assert.equal(payload.components.length,componentEvidence(clinic).length);
      const records=JSON.stringify(payload.groups);
      for (const term of ['빈용탕','기본탕','대안탕','반례탕','나쁨','보통','두통','기침','악화']) {
        assert(records.includes(term),'Missing model evidence: '+term);
      }
      return {text:JSON.stringify({recommendations:[choice]}),model,engine:String(engine)};
    });
    assert.equal(result.status,'synthesized');
    assert.equal(result.model,model);
    assert.equal(result.recommendations.length,1);
    const [base]=result.recommendations;
    assert.equal(base.base,'기본탕');
    assert.equal(base.study.solo.total,0);
    assert.equal(base.study.regimenCount,2);
    assert.deepEqual(base.study.combined,{total:3,good:2,neutral:0,bad:1});
    assert.deepEqual(base.groupIds,choice.groupIds);
    assert.equal(base.limitation,choice.limitation);
    const [addition]=base.additions;
    assert.equal(addition.kind,'observed');
    assert.deepEqual(addition.formulas,['보조탕']);
    assert.equal(addition.when,choice.additions[0].when);
    assert.equal(addition.why,choice.additions[0].why);
    assert(!('rankings' in result) && !('estimatedPercent' in base));
  }
});

test('combining two separately supported formulas is labeled a hypothesis; mixing is optional',async()=>{
  const {clinic,choice,componentId,groupId}=synthesisExample();
  const hypothetical={
    componentIds:[componentId('빈용탕')],
    when:'다른 증상이 함께 있는 경우',
    why:'각기 다른 조합의 사례를 바탕으로 검토할 수 있습니다.',
    groupIds:[groupId('기본탕','보조탕'),groupId('빈용탕','비교탕')],
  };
  for (const additions of [[hypothetical],[]]) {
    const result=await recommendPrescriptions(clinic,'소화불량','gemini-4-argon',async()=>({
      text:JSON.stringify({recommendations:[{...choice,additions}]}),model:'gemini-4-argon',engine:'gemini',
    }));
    assert.equal(result.status,'synthesized');
    const partners=result.recommendations[0].additions;
    assert.equal(partners.length,additions.length);
    if (additions.length) assert.equal(partners[0].kind,'hypothesis');
  }
});

test('rank summaries use the chosen evidence basis and verified row counts; a short list explains the omission',async()=>{
  const {clinic,choice}=synthesisExample();
  const note='다른 후보들은 같은 조합에서만 반복돼 기본 처방을 따로 고르기 어렵습니다.';
  for (const [rankBasis,expected] of [
    ['recurrence','서로 다른 합방 2종에서 좋음 기록'],
    ['targetFeedback','상세에 소화불량 호전 명시 1건'],
    ['contrast','전체 평가 좋음 · 포함 2/3건, 미포함 5/6건'],
  ]) {
    const result=await recommendPrescriptions(clinic,'소화불량','gpt-6.2-astra',async()=>({
      text:JSON.stringify({recommendations:[{...choice,rankBasis}],shortlistNote:note}),
      model:'gpt-6.2-astra',engine:'gpt-astra',
    }));
    assert.equal(result.recommendations[0].headline,expected);
    assert.equal(result.shortlistNote,note);
  }
  const limited=summarize(sample('좋음',''),sample('좋음',''));
  const result=await recommendPrescriptions(limited,'피로','gemini-4-argon',async()=>({
    text:JSON.stringify({recommendations:[{...choice,baseId:1,groupIds:[1],rankBasis:'solo',additions:[]}],shortlistNote:''}),
    model:'gemini-4-argon',engine:'gemini',
  }));
  assert.equal(result.recommendations[0].headline,'무가감 단독 2건 중 2건 좋음');
  assert.equal(result.recommendations[0].study.targetImproved,0);
  assert.match(result.shortlistNote!,/긍정 근거.*1개/);
  const withBackground=summarize(sample('좋음',''),sample('보통','','나처방'),
    ['가상인','두통','나처방','','좋음',''],['가상인','요통','나처방','','좋음','']);
  const compared=await recommendPrescriptions(withBackground,'피로','gpt-6.2-astra',async()=>({
    text:JSON.stringify({recommendations:[{...choice,baseId:1,groupIds:[1],rankBasis:'backgroundUse',additions:[]}],shortlistNote:''}),
    model:'gpt-6.2-astra',engine:'gpt-astra',
  }));
  assert.equal(compared.recommendations[0].headline,'사용 빈도 · 검색 목표 1/2건, 다른 목표 0/2건');
});

test('two members seen only in a three-formula regimen do not become an observed two-formula treatment',async()=>{
  const names=['가처방','나처방','다처방'];
  const clinic=clinicalEvidence([headers,sample('좋음','피로가 호전됨',names.join(' + '))],
    [['처방명'],...names.map(name=>[name])],'피로');
  const ids=componentEvidence(clinic).map(item=>item.formula);
  const proposed={
    baseId:ids.indexOf('가처방')+1,
    reason:'좋음으로 평가된 합방에 포함됐습니다.',
    limitation:'세 처방을 함께 사용해 두 처방만의 효과는 확인되지 않았습니다.',
    guidance:'',
    groupIds:[1],
    additions:[{componentIds:[ids.indexOf('나처방')+1],when:'동반 증상 경과를 확인할 때',
      why:'세 처방과 함께 사용된 사례가 있어 검토합니다.',groupIds:[1]}],
  };
  const result=await recommendPrescriptions(clinic,'피로','gpt-6.2-astra',async()=>({
    text:JSON.stringify({recommendations:[proposed]}),model:'gpt-6.2-astra',engine:'gpt-astra',
  }));
  assert.equal(result.status,'synthesized');
  assert.equal(result.recommendations[0].study.solo.total,0);
  assert.equal(result.recommendations[0].additions[0].kind,'within-larger');
});

test('bad references, duplicate bases, unreadable answers and outages never become clinical recommendations',async()=>{
  const {clinic,choice,groupId,componentId}=synthesisExample();
  const badChoices=[
    '# 비교 보고서',
    JSON.stringify({recommendations:[{...choice,baseId:99999}]}),
    JSON.stringify({recommendations:[{...choice,groupIds:[groupId('반례탕')]}]}),
    JSON.stringify({recommendations:[choice,choice]}),
    JSON.stringify({recommendations:[{...choice,additions:[{...choice.additions[0],componentIds:[componentId('기본탕')]}]}]}),
  ];
  for (const response of [...badChoices,undefined]) {
    const result=await recommendPrescriptions(clinic,'소화불량','gpt-6.2-astra',async()=>{
      if (response===undefined) throw Error('offline');
      return {text:response,model:'gpt-6.2-astra',engine:'gpt-astra'};
    });
    assert.equal(result.status,'model-unavailable');
    assert.deepEqual(result.recommendations,[]);
    assert(!('rankings' in result));
  }
});

test('no positive eligible record leaves evidence available without inventing an inference',async()=>{
  let calls=0;
  for (const clinic of [summarize(),summarize(sample('나쁨','피로 호전됨'),sample('보통',''),sample('미정',''),sample('',''))]) {
    const result=await recommendPrescriptions(clinic,'피로','gemini-4-argon',async()=>{calls++;throw Error('unexpected');});
    assert.equal(result.status,'insufficient');
    assert.deepEqual(result.recommendations,[]);
  }
  assert.equal(calls,0);
});

test('explicit target improvement in neutral feedback can support a base while the neutral grade and adverse contrast remain intact',async()=>{
  const own=['가상인','소화불량, 두통','가처방','','보통','소화불량은 조금 좋아짐'];
  const adverse=['가상인','소화불량','가처방','','나쁨','소화불량 악화됨'];
  const other=['가상인','소화불량, 두통','나처방','','보통','두통은 조금 좋아짐'];
  const clinic=clinicalEvidence([headers,own,adverse,other],catalog,'소화불량');
  const groupId=clinic.groups.findIndex(group=>group.formula==='가처방')+1;
  const baseId=componentEvidence(clinic).findIndex(item=>item.formula==='가처방')+1;
  const choice={baseId,reason:'보통 평가에서 소화불량이 일부 호전된 기록이 있습니다.',
    limitation:'동일 처방에서 악화된 기록도 있습니다.',guidance:'',groupIds:[groupId],additions:[]};
  let calls=0;
  const reply=async()=>{
    calls++;
    return {text:JSON.stringify({recommendations:[choice]}),model:'gpt-6.2-astra',engine:'gpt-astra'};
  };
  const result=await recommendPrescriptions(clinic,'소화불량','gpt-6.2-astra',reply);
  assert.equal(result.status,'synthesized');
  assert.equal(calls,1);
  const [recommended]=result.recommendations;
  assert.equal(recommended.base,'가처방');
  assert.deepEqual(recommended.study.solo,{total:2,good:0,neutral:1,bad:1});
  for (const row of [other,['가상인','소화불량','가처방','','나쁨','소화불량은 조금 좋아짐']]) {
    const unsupported=clinicalEvidence([headers,row],catalog,'소화불량');
    const noChoice=await recommendPrescriptions(unsupported,'소화불량','gpt-6.2-astra',reply);
    assert.equal(noChoice.status,'insufficient');
    assert.deepEqual(noChoice.recommendations,[]);
  }
  assert.equal(calls,1);
  const unrelatedBaseId=componentEvidence(clinic).findIndex(item=>item.formula==='나처방')+1;
  const unrelatedGroupId=clinic.groups.findIndex(group=>group.formula==='나처방')+1;
  const badCitation=await recommendPrescriptions(clinic,'소화불량','gemini-4-argon',async()=>({
    text:JSON.stringify({recommendations:[{...choice,baseId:unrelatedBaseId,groupIds:[unrelatedGroupId]}]}),
    model:'gemini-4-argon',engine:'gemini',
  }));
  assert.equal(badCitation.status,'model-unavailable');
  assert.deepEqual(badCitation.recommendations,[]);
});

test('미정/종결 and missing ratings never enter eligible evidence, even with strongly positive W',()=>{
 const data=summarize(sample('미정','피로 완전히 호전됨','나처방'),sample('종결','좋아짐','나처방'),
   sample('','많이 좋아짐'),sample('알수없음','호전됨'),sample('좋음','','가처방','나처방'),
   sample('보통','문자만 받음'),sample('나쁨','재발'),sample('좋음','좋아짐','미등록'));
 assert.deepEqual(data.excluded,{미정:1,종결:1,결과미기록:1,기타:1});
 assert.equal(data.skipped,1);assert.equal(data.groups.length,2);
 const combo=data.groups.find(g=>g.formula==='가처방 + 나처방')!;
 assert.equal(combo.기록,1);assert.equal(combo.상세미기록,1);assert.equal(combo.details.length,0);
 const single=data.groups.find(g=>g.formula==='가처방')!;
 assert.equal(single.기록,2);assert.equal(single.상세해석불가,1);
 assert.equal(single.details[0].평가,'나쁨');
});

test('undelivered prescriptions never contribute cases or feedback, even if detailed notes exist',()=>{
  const undelivered = [
    sample('', '피로가 완전히 호전됨', '나처방'),
    sample(' \t　', '피로가 악화됨', '가처방'),
    sample('', '', '미등록'),
    sample('', '').slice(0, 4), // Sheets omits trailing empty cells.
  ];
  const eligible = sample('보통', '피로는 조금 좋아졌음');
  const mixed = summarize(eligible, ...undelivered);
  assert.deepEqual(mixed.groups, summarize(eligible).groups);
  assert.deepEqual(mixed.excluded, {미정:0, 종결:0, 결과미기록:4, 기타:0});
  assert.equal(mixed.skipped, 0);
  assert.deepEqual(summarize(...undelivered).groups, []);
});

test('resolves catalog formulas from legacy combined records and treatment additions without inventing a solo effect',()=>{
  const combinedHeaders=['성함','증상','처방 조합','가','감','효과','효과(자세히)'];
  const data=clinicalEvidence([combinedHeaders,
    ['가상인','피로','나처방 ＋ 가처방 (가: 가처방, 감초 3g)','','','좋음',''],
    ['가상인','피로','가처방','나처방, 감초 3g','','좋음',''],
    ['가상인','피로','가처방','감초 +2g','','나쁨',''],
    ['가상인','피로','미등록 + 나처방','','','좋음',''],
  ],catalog,'피로');
  assert.equal(data.skipped,1);
  const combo = data.groups.find(group => group.formula === '가처방 + 나처방')!;
  assert.equal(combo.좋음,2);
  assert.equal(combo.기록,2);
  assert.equal(data.groups.find(group => group.formula === '가처방')!.좋음,0);
  assert.equal(combo.가감기록,2);
  assert.doesNotMatch(JSON.stringify(data),/감초/);
});

test('separates partial target response, worsening of another symptom and missing or uncertain details',()=>{
 const data=summarize(sample('보통','초반 피로는 50% 호전됐지만 두통은 더 심해짐. 이후 피로 재발.'),
   sample('나쁨','피로가 호전되지 않았고 두통은 악화되지 않음'),sample('좋음','피로는 조금 좋아졌고 부작용은 없음'),
   sample('좋음','피로와 두통이 많이 좋아짐. 좋았는지는 모르겠음'));
 const findings=data.groups[0].details;
 function has(grade:string,target:string,course:string,degree?:string,time?:string) {
   return findings.some(f=>f.평가===grade && f.대상===target && f.경과===course && (!degree||f.정도===degree) && (!time||f.시점===time));
 }
 assert(has('보통','검색 증상','호전','50%','초기'));
 assert(has('보통','동반·기타: 두통','악화'));assert(has('보통','검색 증상','재발',undefined,'최근·이후'));
 assert(has('나쁨','검색 증상','호전 없음'));assert(has('나쁨','동반·기타: 두통','악화 부인'));
 assert(has('좋음','동반·기타: 부작용','이상반응 없음 언급'));
 assert(has('좋음','여러 증상 언급·귀속 불명','호전','뚜렷하게'));
 assert(has('좋음','대상 미기재','판단 불확실'));assert(has('좋음','검색 증상','호전','일부·경미하게'));
 assert(!has('나쁨','검색 증상','호전'));
});

test('bounded clinical measurements have fixed units, no raw feedback or extra identifiers, no double counting per record',()=>{
 const data=summarize(sample('보통','합성이름 010-1234-5678, example@private.test. 두통 NRS 8→3점. 두통 NRS 8→3점. 피로 하루 4회에서 2회.'),
   sample('보통','두통 NRS 8에서 3점'),sample('좋음','아주 많이 좋아짐'));
 const findings=data.groups[0].details;
 assert.equal(findings.find(f=>f.정도==='강도 8점→3점')?.건수,2);
 assert.equal(findings.find(f=>f.정도==='하루 빈도 4회→2회')?.대상,'검색 증상');
 assert.equal(findings.find(f=>f.평가==='좋음')?.대상,'대상 미기재');
 assert.doesNotMatch(JSON.stringify(data),/합성이름|010-|private|example@/);
 assert.throws(()=>clinicalEvidence([headers,sample('좋음','')],catalog,'합성이름'));
});
test('preserves whole clinical clauses in order and V-grade linkage, suppressing unknown wording or names as whole clauses',()=>{
 const w='피로는 호전된 것은 아니라고 함. 윤홍증이 사는 가상로 88번길 10에서 만났음. 두통은 조금 좋아졌지만 부작용은 없음.';
 const data=summarize(sample('좋음',w),sample('좋음',w),sample('보통',w),sample('보통','피로는 과장되어 호전됨'),sample('좋음','합성이름 피로 호전됨'));
 const notes=data.groups[0].notes;
 assert.equal(notes.length,2);
 assert.deepEqual(notes[0],{평가:'좋음',내용:['피로는 호전된 것은 아니라고 함','[일부 문맥 비공개]','두통은 조금 좋아졌지만','부작용은 없음'],건수:2});
 assert.equal(notes[1].평가,'보통');assert.equal(notes[1].건수,1);
 assert.doesNotMatch(JSON.stringify(data),/윤홍증|가상로|88번길|합성이름|과장되어/);
 assert(data.groups[0].details.some(f=>f.대상==='검색 증상' && f.경과==='호전 없음'));
});
test('requested models are used exclusively',async()=>{
 const calls:string[]=[];
 await generateFollowUpResponse('synthetic','gpt-astra',{env:{OPENAI_API_KEY:'test'},exactSearchModel:'gpt-6.2-astra',request:async(_,init)=>{
  calls.push(JSON.parse(String(init?.body)).model);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]});
 }});
 await assert.rejects(generateFollowUpResponse('synthetic','gemini',{env:{GEMINI_API_KEY:'test'},exactSearchModel:'gemini-4-argon',geminiGenerate:async m=>{calls.push(m);throw Error('unavailable');}}));
 assert.deepEqual(calls,['gpt-6.2-astra','gemini-4-argon']);
});
