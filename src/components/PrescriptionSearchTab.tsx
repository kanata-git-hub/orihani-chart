import React, {useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {authFetch} from '../authFetch';
import type {clinicalEvidence} from '../../prescriptionSearch';

type Result = {text: string; model?: string; clinic: ReturnType<typeof clinicalEvidence>};
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
  return <section className="min-w-0 bg-white border-2 border-primary p-3 sm:p-5 space-y-4">
    <h2 className="font-bold text-xl">증상별 처방 검색</h2>
    <form role="search" aria-label="증상별 처방 검색" onSubmit={search} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-end">
      <label className="col-span-2 sm:col-span-1 min-w-0 text-sm font-bold">증상 또는 질병
        <input type="search" enterKeyHint="search" className="mt-1 w-full min-h-12 border border-primary/40 rounded px-3 text-base font-normal" placeholder="예: 소화불량" required minLength={2} maxLength={60} disabled={busy} value={query} onChange={e=>{setQuery(e.target.value);setResult(null);setError('');}}/>
      </label>
      <label className="min-w-0 text-sm font-bold">판단 모델
        <select className="mt-1 w-full min-w-0 min-h-12 border border-primary/40 rounded px-2 text-base font-normal" disabled={busy} value={model} onChange={e=>{setModel(e.target.value);setResult(null);setError('');}}>
          <option value="gpt-6.2-astra">GPT-6.2 Astra</option><option value="gemini-4-argon">Gemini 4 Argon</option>
        </select>
      </label>
      <button type="submit" disabled={busy} className="min-h-12 min-w-16 rounded bg-primary text-white font-bold px-3 disabled:opacity-60">{busy?'검색 중…':'검색'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">시트의 평가와 상세 피드백을 확인하고 있습니다.</p>}
    {result && <div aria-live="polite" className="space-y-4 min-w-0 [overflow-wrap:anywhere]">
      <h3 className="font-bold">처방 판단 {result.model && '· '+result.model}</h3><p className="whitespace-pre-wrap leading-relaxed">{result.text}</p>
      <h3 className="font-bold">한약환자관리 시트 · 처방 기록 기준</h3>
      {result.clinic.groups.map(g=><section key={g.formula} className="border-l-2 border-primary/30 pl-3 space-y-1">
        <h4 className="font-bold">{g.formula} · 평가 대상 {g.기록}건</h4>
        <p>좋음 {g.좋음} · 보통 {g.보통} · 나쁨 {g.나쁨}</p>
        <p>상세 기록 {g.상세기록}건 · 미작성 {g.상세미기록}건 · 내용 해석 불가 {g.상세해석불가}건</p>
        {Boolean(g.notes.length || g.details.length) && <details><summary className="min-h-11 py-2 cursor-pointer font-medium">상세 피드백 보기</summary>
          {g.notes.length > 0 && <ul className="list-disc pl-5 space-y-2">{g.notes.map((note,i)=><li key={i}>
            <strong>{note.평가}</strong> · {note.내용.join(' / ')} ({note.건수}건)
          </li>)}</ul>}
          {g.details.length > 0 && <p className="pt-2 font-medium">경과와 정도</p>}
          <ul className="list-disc pl-5 space-y-2">
          {g.details.map((detail,i)=><li key={i}>
            {Object.entries(detail).filter(([field,value])=>field!=='건수' && value!=='').map(([field,value])=>field+' '+value).join(' · ')} ({detail.건수}건)
          </li>)}
        </ul></details>}
      </section>)}
      {!result.clinic.groups.length && <p>집계 가능한 기록 없음</p>}
      <p>평가 제외 · 미정 {result.clinic.excluded.미정}건 · 종결 {result.clinic.excluded.종결}건 · 등급 미기록 {result.clinic.excluded.결과미기록}건 · 기타 {result.clinic.excluded.기타}건</p>
      {result.clinic.skipped>0 && <p>처방 식별이 어려운 기록 {result.clinic.skipped}건 제외</p>}
    </div>}
  </section>
}
