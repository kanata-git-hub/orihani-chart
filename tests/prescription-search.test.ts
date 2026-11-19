import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {clinicalEvidence,referenceEvidence} from '../prescriptionSearch.ts';
import {generateFollowUpResponse} from '../followUpEngine.ts';
const rows=[
 ['성함','증상','처방','처방2','효과','효과(자세히)'],
 ['합성이름','피로','가처방','나처방','종결','합성이름 010-0000-0000'],
 ['합성이름','피로','가처방','나처방','좋음','많이 좋아짐'],
 ['다른이름','피로','가처방','','',''],
 ['다른이름','피로','미등록이름','','',''],
];
test('counts treatment records, separates combinations, excludes raw personal fields and missing ratings',()=>{
 const catalog=[['처방명'],['가처방'],['나처방']];
 const out=clinicalEvidence(rows,catalog,'피로');
 assert.equal(out.groups.length,2);assert.equal(out.skipped,1);
 const both=out.groups[0];assert.equal(both.기록,2);assert.equal(both.좋음,1);assert.equal(both.판정불명,1);
 assert.equal(both.상세호전언급,1);assert.equal(out.groups[1].결과미기록,1);
 assert.doesNotMatch(JSON.stringify(out),/합성이름|010-|다른이름|미등록이름/);
 assert.throws(()=>clinicalEvidence(rows,catalog,'합성이름'));
});
test('source retrieval is tied to symptom or observed formula and retains attribution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reference-'));
 const old=process.env.TSUMURA_REFERENCE_JSON;
 try {
  process.env.TSUMURA_REFERENCE_JSON=join(dir,'source.json');
  await writeFile(process.env.TSUMURA_REFERENCE_JSON,JSON.stringify([{formula:'가처방',text:'합성문헌 식욕부진',source:'합성 1쪽'},{formula:'나처방',text:'합성문헌 두통',source:'합성 2쪽'}]));
  assert.equal((await referenceEvidence('피로',['가처방'])).excerpts[0].source,'합성 1쪽');
  assert.equal((await referenceEvidence('두통',[])).excerpts[0].formula,'나처방');
 } finally {if(old===undefined)delete process.env.TSUMURA_REFERENCE_JSON;else process.env.TSUMURA_REFERENCE_JSON=old;await rm(dir,{recursive:true});}
});
test('search routes exclusively to requested models',async()=>{
 const calls:string[]=[];
 await generateFollowUpResponse('synthetic','gpt-astra',{env:{OPENAI_API_KEY:'test'},exactSearchModel:'gpt-6.2-astra',request:async(_,init)=>{
  calls.push(JSON.parse(String(init?.body)).model);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]});
 }});
 await assert.rejects(generateFollowUpResponse('synthetic','gemini',{env:{GEMINI_API_KEY:'test'},exactSearchModel:'gemini-4-argon',geminiGenerate:async m=>{calls.push(m);throw Error('unavailable');}}));
 assert.deepEqual(calls,['gpt-6.2-astra','gemini-4-argon']);
});
