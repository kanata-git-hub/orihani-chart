import React, {useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {authFetch} from '../authFetch';

type Result = {text:string, model?:string, clinic:{skipped:number, groups:Array<{formula:string,기록:number,좋음:number,보통:number,나쁨:number,판정불명:number,결과미기록:number,상세기록:number}>},reference:{status:string,excerpts:Array<{source:string,formula:string,text:string}>}};
export function PrescriptionSearchTab() {
  const {googleAccessToken,reconnectGoogle}=useAuth();
  const [query,setQuery]=useState(''), [model,setModel]=useState('gpt-6.2-astra');
  const [result,setResult]=useState<Result|null>(null), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [expired,setExpired]=useState(false);
  async function search(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setResult(null); setError('');
    try {
      const accessToken=(!googleAccessToken||expired)?await reconnectGoogle():googleAccessToken;
      if(!accessToken) throw Error('시트를 읽으려면 Google 계정을 연결해주세요.');
      const res=await authFetch('/api/prescription-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:query.trim(),model,accessToken})});
      setExpired(res.status===401);
      const data=await res.json();
      if(!res.ok) throw Error(data.error||'검색에 실패했습니다.');
      setResult(data);
    } catch(err) { setError(err instanceof Error?err.message:'검색에 실패했습니다.'); }
    finally {setBusy(false);}
  }
  return <section className="bg-white border-2 border-primary p-5 space-y-5">
    <h2 className="font-bold text-xl">증상별 처방 검색</h2>
    <form onSubmit={search} className="flex flex-wrap gap-3">
      <input aria-label="증상 또는 질병" className="border p-2 flex-1" placeholder="증상 또는 질병 이름" required minLength={2} maxLength={60} disabled={busy} value={query} onChange={e=>{setQuery(e.target.value);setResult(null);}}/>
      <select aria-label="판단 모델" disabled={busy} value={model} onChange={e=>{setModel(e.target.value);setResult(null);}}><option value="gpt-6.2-astra">GPT-6.2 Astra</option><option value="gemini-4-argon">Gemini 4 Argon</option></select>
      <button disabled={busy} className="bg-primary text-white px-4">{busy?'검색 중…':'검색'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <div aria-live="polite" className="space-y-4">
      <h3 className="font-bold">처방 판단 {result.model && '· '+result.model}</h3><p className="whitespace-pre-wrap">{result.text}</p>
      <h3 className="font-bold">한약환자관리 시트 · 처방 기록 기준</h3>
      {result.clinic.groups.map(g=><p key={g.formula}>{g.formula} · {g.기록}건 (좋음 {g.좋음}, 보통 {g.보통}, 나쁨 {g.나쁨}, 판정 불명 {g.판정불명}, 결과 미기록 {g.결과미기록}) · 상세 피드백 {g.상세기록}건</p>)}
      {!result.clinic.groups.length && <p>집계 가능한 기록 없음</p>}
      {result.clinic.skipped>0 && <p>처방 식별이 어려운 기록 {result.clinic.skipped}건 제외</p>}
      <h3 className="font-bold">{result.reference.status}</h3>
      {result.reference.excerpts.map((x,i)=><p key={i}>{x.formula} · {x.source}<br/>{x.text}</p>)}
    </div>}
  </section>
}
