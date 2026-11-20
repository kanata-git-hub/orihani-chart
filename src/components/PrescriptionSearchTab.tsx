import React, {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {useAuth} from '../contexts/AuthContext';
import {authFetch} from '../authFetch';
import type {clinicalEvidence} from '../../prescriptionSearch';
import type {PrescriptionRecommendation} from '../../prescriptionRecommendations';

type Clinic = ReturnType<typeof clinicalEvidence>;
type Result = {
  recommendations: PrescriptionRecommendation[];
  status: 'synthesized' | 'insufficient' | 'model-unavailable';
  text: string;
  model?: string;
  clinic: Clinic;
};

const additionLabels = {
  observed: '같은 조합 기록 있음',
  'within-larger': '더 큰 합방에서 함께 사용',
  hypothesis: '함께 쓴 기록 없는 제안',
};

function EvidenceList({ids, clinic}: {ids: number[]; clinic: Clinic}) {
  return <ul className="list-disc space-y-1 pl-5">{ids.map(id => {
    const group = clinic.groups[id - 1];
    return group && <li key={id}>{group.formula} · 좋음 {group.좋음} / 보통 {group.보통} / 나쁨 {group.나쁨}</li>;
  })}</ul>;
}

function BaseRecommendation({candidate, clinic, position}: {candidate: PrescriptionRecommendation; clinic: Clinic; position: number}) {
  const {base, study, additions} = candidate;
  return <li>
    <details open={position === 0} className="group/option">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 text-sm">{position + 1}순위</span>
        <strong className="min-w-0 flex-1">{base}</strong>
        <ChevronDown size={18} aria-hidden="true" className="shrink-0 group-open/option:rotate-180"/>
      </summary>
      <div className="space-y-2 pb-2 text-sm leading-snug">
        <p className="text-primary/80">시트 관찰 · {study.solo.total > 0 ? '단독 '+study.solo.total+'건' : '단독 사용 기록 없음'} · 합방 {study.regimenCount - (study.solo.total > 0 ? 1 : 0)}종 {study.combined.total}건
          {study.included.bad > 0 && <span className="font-medium text-red-800"> · 나쁨 {study.included.bad}건 포함</span>}
        </p>
        <p><strong>{study.solo.total > 0 ? '기본 처방으로 보는 이유' : '합방 기록에서 추론한 이유'}</strong> · {candidate.reason}</p>
        {additions.length === 0 && <p>이 후보에는 추가 합방 제안이 없습니다.</p>}
        {additions.map(addition => <div key={addition.formulas.join('+')} className="border-l-2 border-primary/25 pl-2.5">
          <p className="font-bold">합방 후보 · {addition.formulas.join(' + ')}</p>
          <p className="text-primary/75">{additionLabels[addition.kind]}</p>
          <p><strong>고려할 때</strong> · {addition.when}</p>
          <p><strong>함께 쓰는 이유</strong> · {addition.why}</p>
        </div>)}
        <details className="border-t border-primary/10">
          <summary className="min-h-11 cursor-pointer py-2.5 font-medium">시트 근거와 해석 한계</summary>
          <div className="space-y-2 pb-2">
            <table className="w-full text-right tabular-nums">
              <caption className="pb-1 text-left font-medium">검색 증상이 기록된 사례</caption>
              <thead><tr><th scope="col" className="text-left">처방 구성</th><th scope="col">좋음</th><th scope="col">보통</th><th scope="col">나쁨</th></tr></thead>
              <tbody>{([['단독',study.solo],['합방에 포함',study.combined],['기본 처방 미포함',study.absent]] as const).map(([label,count]) =>
                <tr key={label}><th scope="row" className="text-left font-normal">{label}</th><td>{count.good}</td><td>{count.neutral}</td><td>{count.bad}</td></tr>)}
              </tbody>
            </table>
            {candidate.groupIds.length > 0 && <EvidenceList ids={candidate.groupIds} clinic={clinic}/>}
            {additions.map(addition => <div key={addition.formulas.join('+')}>
              <p className="font-medium">{addition.formulas.join(' + ')} 합방 검토에 참고한 기록</p>
              {addition.groupIds.length > 0 && <EvidenceList ids={addition.groupIds} clinic={clinic}/>}
              <p>{addition.matchedComparisons.length ? '나머지 처방 구성이 같은 비교 조합 '+addition.matchedComparisons.length+'쌍' : '다른 처방 구성을 같게 두고 이 추가분만 비교할 기록이 없습니다.'}</p>
            </div>)}
            {candidate.guidance && <p><strong>원내 쯔무라 지침 해석</strong> · {candidate.guidance}</p>}
            {candidate.limitation && <p><strong>해석 한계</strong> · {candidate.limitation}</p>}
          </div>
        </details>
      </div>
    </details>
  </li>;
}

function ClinicalRecords({clinic, model}: {clinic: Clinic; model?: string}) {
  return <details className="border-t border-primary/15 text-sm">
    <summary className="min-h-11 cursor-pointer py-3 font-medium">전체 시트 기록 · 처방 {clinic.groups.length}종</summary>
    <div className="space-y-3 pb-2">
      {clinic.targets.length > 1 && <p>{clinic.targets.join(' · ')} 중 하나 이상이 기록된 사례입니다. 한 사례는 한 번만 셉니다.</p>}
      {clinic.groups.map(group => <details key={group.formula} className="border-l-2 border-primary/25 pl-3">
        <summary className="min-h-11 cursor-pointer py-2">
          <strong>{group.formula}</strong> · 평가 {group.기록}건
        </summary>
        <div className="space-y-1.5 pb-2">
          <p>좋음 {group.좋음} · 보통 {group.보통} · 나쁨 {group.나쁨}</p>
          <p>상세 작성 {group.상세기록}건 · 미작성 {group.상세미기록}건 · 해석 불가 {group.상세해석불가}건</p>
          <ul className="space-y-1.5">{group.contexts.map((context, i) => <li key={i} className="border-t border-primary/10 pt-1.5">
            <p><strong>{context.grade} {context.count}건</strong> · 기록된 검색 증상 {context.targets.join(', ')}</p>
            {context.coSymptoms.length > 0 && <p>같이 적힌 증상 · {context.coSymptoms.join(', ')}</p>}
            {context.notes.length > 0 && <p>상세 피드백 · {context.notes.join(' / ')}</p>}
            {context.feedback.map((finding,j) => <p key={j}>{[finding.대상, finding.경과, finding.정도, finding.시점].filter(Boolean).join(' · ')}</p>)}
            {context.detailStatus !== '내용 확인' && <p>상세 {context.detailStatus}</p>}
            {context.modified && <p>가감 기록 있음</p>}
          </li>)}</ul>
        </div>
      </details>)}
      <p>평가 제외 · 처방 미전달(효과 빈칸) {clinic.excluded.결과미기록}건 · 미정 {clinic.excluded.미정}건 · 종결 {clinic.excluded.종결}건 · 기타 {clinic.excluded.기타}건</p>
      {clinic.skipped > 0 && <p>처방을 식별하기 어려운 기록 {clinic.skipped}건 제외</p>}
      {model && <p>해석 모델 · {model}</p>}
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
      const res=await authFetch('/api/prescription-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:query.trim(),model,accessToken,view:'component-synthesis'})});
      setExpired(res.status===401);
      const data=await res.json();
      if(!res.ok) throw Error(data.error||'검색에 실패했습니다.');
      if (!Array.isArray(data.recommendations)) throw Error('처방 제안을 불러오지 못했습니다. 잠시 후 다시 검색해주세요.');
      setResult(data);
    } catch(err) { setError(err instanceof Error?err.message:'검색에 실패했습니다.'); }
    finally {setBusy(false);}
  }
  return <section className="min-w-0 bg-white border-2 border-primary p-3 sm:p-5 space-y-4">
    <h2 className="font-bold text-xl">증상별 처방 검색</h2>
    <form role="search" aria-label="증상별 처방 검색" onSubmit={search} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-end">
      <label className="col-span-2 sm:col-span-1 min-w-0 text-sm font-bold">증상 또는 질병 <span className="font-normal">· 여러 개는 쉼표로 구분</span>
        <input type="search" enterKeyHint="search" className="mt-1 w-full min-h-12 border border-primary/40 rounded px-3 text-base font-normal" placeholder="예: 소화불량, 피로" required minLength={2} maxLength={60} disabled={busy} value={query} onChange={e=>{setQuery(e.target.value);setResult(null);setError('');}}/>
      </label>
      <label className="min-w-0 text-sm font-bold">판단 모델
        <select className="mt-1 w-full min-w-0 min-h-12 border border-primary/40 rounded px-2 text-base font-normal" disabled={busy} value={model} onChange={e=>{setModel(e.target.value);setResult(null);setError('');}}>
          <option value="gpt-6.2-astra">GPT-6.2 Astra</option><option value="gemini-4-argon">Gemini 4 Argon</option>
        </select>
      </label>
      <button type="submit" disabled={busy} className="min-h-12 min-w-16 rounded bg-primary text-white font-bold px-3 disabled:opacity-60">{busy?'검색 중…':'검색'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">처방별 경과와 여러 합방에 공통으로 쓰인 처방을 비교하고 있습니다.</p>}
    {result && <div aria-live="polite" className="min-w-0 [overflow-wrap:anywhere]">
      <h3 className="font-bold text-lg">기본 처방과 합방 제안</h3>
      {result.recommendations.length > 0 && <ol className="divide-y divide-primary/15">
        {result.recommendations.map((candidate, i) => <BaseRecommendation key={candidate.base} candidate={candidate} clinic={result.clinic} position={i}/>)}
      </ol>}
      {result.status !== 'synthesized' && <p className="py-2 text-sm">{result.text}</p>}
      <ClinicalRecords clinic={result.clinic} model={result.model}/>
    </div>}
  </section>
}
