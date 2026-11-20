import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalEvidence} from '../prescriptionSearch.ts';
import {generateFollowUpResponse} from '../followUpEngine.ts';

const catalog=[['처방명'],['가처방'],['나처방']];
const headers=['성함','증상','처방','처방2','효과','효과(자세히)'];
const sample=(v:string,w:string,formula='가처방',second='')=>['합성이름','피로, 두통',formula,second,v,w];
const summarize=(...rows:string[][])=>clinicalEvidence([headers,...rows],catalog,'피로');

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
