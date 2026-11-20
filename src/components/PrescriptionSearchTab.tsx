import React, {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {useAuth} from '../contexts/AuthContext';
import {authFetch} from '../authFetch';
import type {clinicalEvidence, rankPrescriptions} from '../../prescriptionSearch';

type Clinic = ReturnType<typeof clinicalEvidence>;
type RankedPrescription = ReturnType<typeof rankPrescriptions>[number];
type Insight = {formula: string; detail: string; guidance: string};
type Result = {rankings: RankedPrescription[]; insights: Insight[]; text?: string; model?: string; clinic: Clinic};

function RankedRow({rank, candidate, insight}: {rank: number; candidate: RankedPrescription; insight?: Insight}) {
  return <li>
    <details className="group">
      <summary className="grid min-h-12 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="font-bold text-primary">{rank}위</span>
        <span className="min-w-0">
          <strong className="block leading-snug">{candidate.formula}</strong>
          <span className="block text-sm text-primary/80">좋음 {candidate.good}/{candidate.total}건 · 보정 긍정률 {candidate.estimatedPercent}%</span>
          {candidate.targetCaution > 0 && <span className="block text-sm font-medium text-red-800">검색 증상 경과 주의 {candidate.targetCaution}건</span>}
        </span>
        <ChevronDown size={18} aria-hidden="true" className="mt-1 group-open:rotate-180"/>
        <span className="sr-only">추천 근거</span>
      </summary>
      <div className="space-y-1.5 border-l-2 border-primary/25 pl-3 mb-3 text-sm">
        <p><strong>시트 관찰</strong> · 좋음 {candidate.good}/{candidate.total}건 ({candidate.observedPercent}%)</p>
        {insight?.detail && <p>{insight.detail}</p>}
        {insight?.guidance && <p><strong>원내 쯔무라 지침 해석</strong> · {insight.guidance}</p>}
      </div>
    </details>
  </li>;
}

function ClinicalRecords({clinic}: {clinic: Clinic}) {
  return <details className="border-t border-primary/15 text-sm">
    <summary className="min-h-11 cursor-pointer py-3 font-medium">전체 시트 기록 · 처방 {clinic.groups.length}종</summary>
    <div className="space-y-3 pb-2">
      {clinic.groups.map(group => <details key={group.formula} className="border-l-2 border-primary/25 pl-3">
        <summary className="min-h-11 cursor-pointer py-2">
          <strong>{group.formula}</strong> · 평가 {group.기록}건
        </summary>
        <div className="space-y-1.5 pb-2">
          <p>좋음 {group.좋음} · 보통 {group.보통} · 나쁨 {group.나쁨}</p>
          <p>상세 작성 {group.상세기록}건 · 미작성 {group.상세미기록}건 · 해석 불가 {group.상세해석불가}건</p>
          {group.notes.length > 0 && <ul className="list-disc pl-5">{group.notes.map((note,i) => <li key={i}>
            {note.평가} · {note.내용.join(' / ')} ({note.건수}건)
          </li>)}</ul>}
          {group.details.length > 0 && <ul className="list-disc pl-5">{group.details.map((finding,i) => <li key={i}>
            {[finding.평가, finding.대상, finding.경과, finding.정도, finding.시점].filter(Boolean).join(' · ')} ({finding.건수}건)
          </li>)}</ul>}
        </div>
      </details>)}
      <p>평가 제외 · 처방 미전달(효과 빈칸) {clinic.excluded.결과미기록}건 · 미정 {clinic.excluded.미정}건 · 종결 {clinic.excluded.종결}건 · 기타 {clinic.excluded.기타}건</p>
      {clinic.skipped > 0 && <p>처방을 식별하기 어려운 기록 {clinic.skipped}건 제외</p>}
    </div>
  </details>;
}

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
      if (!Array.isArray(data.rankings)) throw Error('추천 순위를 불러오지 못했습니다. 잠시 후 다시 검색해주세요.');
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
    {result && <div aria-live="polite" className="min-w-0 [overflow-wrap:anywhere]">
      <h3 className="font-bold text-lg">추천 처방{result.rankings.length > 0 && ' '+result.rankings.length+'개'}</h3>
      {result.rankings.length > 0 && <ol className="divide-y divide-primary/15">
        {result.rankings.map((candidate,i) => <RankedRow key={candidate.formula} rank={i+1} candidate={candidate}
          insight={result.insights?.find(note => note.formula === candidate.formula)}/>)}
      </ol>}
      {!result.model && result.text && <p className="py-2 text-sm">{result.text}</p>}
      {result.rankings.length > 0 && <details className="border-t border-primary/15 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">순위 계산 기준</summary>
        <div className="space-y-1.5 pb-3">
          <p>검색 증상이 적힌 기록에서 ‘좋음’을 긍정으로 셉니다. 상세란이 비거나 다른 증상만 적혀 있어도 ‘좋음’은 포함합니다.</p>
          <p>보정 긍정률은 (좋음 건수 + 1) ÷ (평가 건수 + 2)입니다. 사례가 적을 때 1건의 영향이 지나치게 커지지 않도록 보정한 원내 기록 비교값입니다. 개인별 치료 확률은 산출하지 않습니다.</p>
          <p>보정 긍정률이 같으면 상세란에 확인된 검색 증상의 경과와 평가 건수를 비교합니다. 여기까지 같으면 선택한 AI가 원내 지침을 참고해 순서를 정합니다.</p>
          {result.model && <p>근거 해석 모델 · {result.model}</p>}
        </div>
      </details>}
      <ClinicalRecords clinic={result.clinic}/>
    </div>}
  </section>
}
