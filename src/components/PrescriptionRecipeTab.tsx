import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Leaf, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { authFetch } from '../authFetch';
import { useAuth } from '../contexts/AuthContext';

interface PrescriptionPatient {
  id: string;
  name: string;
  chartNumber: string;
  age: string;
  gender: string;
  symptoms: string;
  date: string;
  dateLabel: string;
  rowNumber: number;
  prescription: string;
  formulas: string[];
  additions: string;
  removals: string;
  recordCount: number;
}

interface RecipeResult {
  patient: PrescriptionPatient;
  herbs: Array<{ name: string; dailyGrams: number }>;
  warnings?: string[];
  fetchedAt: string;
}

const grams = (amount: number) => new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 6,
}).format(amount);

const patientMeta = (patient: PrescriptionPatient) => [
  patient.gender || '성별 미입력',
  patient.age ? `${patient.age}세` : '',
  patient.chartNumber ? `차트 ${patient.chartNumber}` : '차트번호 미입력',
].filter(Boolean).join(' · ');

export const PrescriptionRecipeTab: React.FC = () => {
  const { googleAccessToken, reconnectGoogle, user } = useAuth();
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [patients, setPatients] = useState<PrescriptionPatient[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [busy, setBusy] = useState<'search' | 'recipe' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement | null>(null);

  const cancelRequest = () => {
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
  };

  useEffect(() => {
    cancelRequest();
    setName('');
    setGender('');
    setSymptoms('');
    setPatients([]);
    setHasSearched(false);
    setSelectedId(null);
    setRecipe(null);
    setBusy(null);
    setError(null);
    setNeedsReconnect(false);
    return cancelRequest;
  }, [user?.uid]);

  const clearResults = () => {
    cancelRequest();
    setPatients([]);
    setHasSearched(false);
    setSelectedId(null);
    setRecipe(null);
    setBusy(null);
    setError(null);
  };

  const reset = () => {
    clearResults();
    setName('');
    setGender('');
    setSymptoms('');
  };

  const request = async (path: string, body: Record<string, string>, forceReconnect = false) => {
    cancelRequest();
    const version = requestVersion.current;
    const abortController = new AbortController();
    controller.current = abortController;
    const token = forceReconnect || !googleAccessToken
      ? await reconnectGoogle()
      : googleAccessToken;
    if (version !== requestVersion.current) return null;
    if (!token) {
      setNeedsReconnect(true);
      throw new Error('Google 계정을 연결하지 못했습니다. 팝업 차단 여부를 확인한 뒤 다시 연결해주세요.');
    }
    const response = await authFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, accessToken: token }),
      signal: abortController.signal,
      cache: 'no-store',
    });
    if (version !== requestVersion.current) return null;
    const data = await response.json().catch(() => {
      throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.');
    });
    if (version !== requestVersion.current) return null;
    if (!response.ok) {
      if (response.status === 401) setNeedsReconnect(true);
      throw new Error(typeof data.error === 'string' ? data.error : '시트 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
    setNeedsReconnect(false);
    return data;
  };

  const searchPatients = async (forceReconnect = false) => {
    if (!name.trim()) {
      setError('환자 이름을 입력해주세요. 성별과 증상은 선택 사항입니다.');
      return;
    }
    setPatients([]);
    setSelectedId(null);
    setRecipe(null);
    setHasSearched(false);
    setError(null);
    setBusy('search');
    const promise = request('/api/prescription-patients', { name: name.trim(), gender, symptoms: symptoms.trim() }, forceReconnect);
    const version = requestVersion.current;
    try {
      const data = await promise;
      if (!data || version !== requestVersion.current) return;
      setPatients(data.patients);
      setHasSearched(true);
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err instanceof Error ? err.message : '환자 검색에 실패했습니다. 다시 시도해주세요.');
      }
    } finally {
      if (version === requestVersion.current) setBusy(null);
    }
  };

  const loadRecipe = async (patientId: string) => {
    setSelectedId(patientId);
    setRecipe(null);
    setError(null);
    setBusy('recipe');
    const promise = request('/api/prescription-recipe', { patientId });
    const version = requestVersion.current;
    try {
      const data = await promise;
      if (!data || version !== requestVersion.current) return;
      setRecipe(data);
      setPatients(previous => previous.map(patient => patient.id === patientId ? data.patient : patient));
      // Move focus to the selected prescription without forcing a mobile scroll.
      requestAnimationFrame(() => {
        if (version === requestVersion.current) resultHeading.current?.focus({ preventScroll: true });
      });
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err instanceof Error ? err.message : '처방 레시피를 불러오지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      if (version === requestVersion.current) setBusy(null);
    }
  };

  const totalDaily = recipe?.herbs.reduce((total, herb) => total + herb.dailyGrams, 0) || 0;
  const inputClass = 'w-full min-w-0 border border-primary/40 bg-bg-input p-3 text-base leading-6 focus:outline-none focus:ring-2 focus:ring-accent';

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-6 text-base leading-relaxed">
      <div className="flex items-start gap-3">
        <Leaf className="mt-1 shrink-0" size={27} aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold md:text-3xl">처방 레시피</h1>
          <p className="mt-1 text-primary/80">환자를 찾고, 시트에 기록된 최신 처방의 약재량을 확인하세요.</p>
        </div>
      </div>

      <form className="border-2 border-primary bg-white p-4 shadow-[4px_4px_0px_0px_rgba(85,44,36,0.12)] sm:p-5" onSubmit={event => { event.preventDefault(); void searchPatients(); }}>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_150px_1.5fr]">
          <div className="min-w-0">
            <label htmlFor="recipe-patient-name" className="mb-1 block font-bold">환자 이름 <span className="text-sm font-normal">필수</span></label>
            <input id="recipe-patient-name" value={name} onChange={event => { clearResults(); setName(event.target.value); }} autoComplete="off" placeholder="성함 입력" className={inputClass} required maxLength={100} />
          </div>
          <div className="min-w-0">
            <label htmlFor="recipe-gender" className="mb-1 block font-bold">성별 <span className="text-sm font-normal">선택</span></label>
            <select id="recipe-gender" value={gender} onChange={event => { clearResults(); setGender(event.target.value); }} className={inputClass}>
              <option value="">전체</option>
              <option value="여">여</option>
              <option value="남">남</option>
            </select>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <label htmlFor="recipe-symptoms" className="mb-1 block font-bold">주요 증상 <span className="text-sm font-normal">선택</span></label>
            <input id="recipe-symptoms" value={symptoms} onChange={event => { clearResults(); setSymptoms(event.target.value); }} autoComplete="off" placeholder="예: 소화불량" className={inputClass} maxLength={200} />
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-primary/75">이름만 입력해도 검색됩니다. 동명이인은 아래 결과의 성별·나이·증상·차트번호로 구분하세요.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={busy === 'search'} className="flex min-h-12 flex-1 items-center justify-center gap-2 border-2 border-primary bg-accent px-5 py-2.5 font-bold hover:bg-accent-hover disabled:opacity-60 sm:flex-none">
            {busy === 'search' ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
            {busy === 'search' ? '검색 중…' : '환자 검색'}
          </button>
          <button type="button" onClick={reset} className="flex min-h-12 items-center justify-center gap-1 border border-primary/40 bg-white px-4 py-2.5 hover:bg-bg-input"><X size={18} aria-hidden="true" /> 지우기</button>
        </div>
      </form>

      {error && <div role="alert" className="flex items-start gap-3 border border-red-300 bg-red-50 p-4 text-red-800">
        <AlertCircle size={21} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 break-words">
          <p>{error}</p>
          {needsReconnect && <button type="button" onClick={() => void searchPatients(true)} disabled={!!busy} className="mt-3 border border-red-800 bg-white px-3 py-2 font-bold disabled:opacity-50">Google 다시 연결 후 검색</button>}
        </div>
      </div>}

      <div role="status" aria-live="polite" className="sr-only">
        {busy === 'search' ? '환자를 검색하고 있습니다.' : busy === 'recipe' ? '최신 처방과 약재 용량을 불러오고 있습니다.' : recipe ? '처방 레시피를 불러왔습니다.' : hasSearched ? `검색 결과 ${patients.length}명입니다.` : ''}
      </div>

      {hasSearched && <section aria-labelledby="recipe-patients-heading" className="space-y-3">
        <h2 id="recipe-patients-heading" className="text-xl font-bold">검색 결과 <span className="text-base font-normal">{patients.length}명 · 환자를 선택하세요</span></h2>
        {patients.length === 0 ? <div className="border border-primary/20 bg-white p-5">일치하는 환자가 없습니다. 이름을 확인하거나 성별·증상 조건을 지우고 다시 검색해주세요.</div> : <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {patients.map(patient => <button key={patient.id} type="button" onClick={() => void loadRecipe(patient.id)} aria-pressed={selectedId === patient.id} className={`min-w-0 border-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selectedId === patient.id ? 'border-primary bg-accent/20' : 'border-primary/25 bg-white hover:border-primary/60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="break-words text-xl font-bold">{patient.name}</span>
              <span className="text-sm">{selectedId === patient.id ? '선택됨' : '레시피 보기'}</span>
            </div>
            <p className="mt-1 break-words">{patientMeta(patient)}</p>
            <p className="mt-2 break-words font-medium">{patient.symptoms || '증상 미입력'}</p>
            <p className="mt-2 text-sm text-primary/75">최근 기록 · {patient.dateLabel} {patient.date || ''} · {patient.rowNumber}행</p>
            <p className="mt-1 break-words text-sm">{patient.prescription || '처방 미입력'}</p>
          </button>)}
        </div>}
      </section>}

      {busy === 'recipe' && <div className="flex items-center gap-3 border border-primary/20 bg-white p-5" role="status"><Loader2 size={22} className="shrink-0 animate-spin" aria-hidden="true" /><span>최신 처방과 약재 용량을 확인하고 있습니다…</span></div>}

      {recipe && <section aria-labelledby="recipe-result-heading" className="min-w-0 space-y-4">
        <div className="min-w-0 border-2 border-primary bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="recipe-result-heading" ref={resultHeading} tabIndex={-1} className="break-words text-2xl font-bold outline-none">{recipe.patient.name}님의 최신 처방</h2>
              <p className="mt-1 break-words">{patientMeta(recipe.patient)}</p>
            </div>
            <button type="button" onClick={() => void loadRecipe(recipe.patient.id)} disabled={!!busy} className="flex items-center gap-2 border border-primary/40 px-3 py-2 text-base hover:bg-bg-input disabled:opacity-50"><RefreshCw size={17} aria-hidden="true" /> 최신 내용 새로고침</button>
          </div>
          <p className="mt-3 break-words">{recipe.patient.symptoms || '증상 미입력'}</p>
          <p className="mt-1 text-sm text-primary/75">{recipe.patient.dateLabel} {recipe.patient.date || ''} · 한약환자 {recipe.patient.rowNumber}행 · 기록 {recipe.patient.recordCount}건</p>
          <div className="mt-4 border-l-4 border-accent bg-bg-light p-3 sm:p-4">
            <p className="text-sm font-bold text-primary/75">처방 조합</p>
            <p className="mt-1 break-words text-xl font-bold leading-relaxed">{recipe.patient.formulas.join(' + ') || recipe.patient.prescription}</p>
            {recipe.patient.additions && <p className="mt-2 break-words">가: {recipe.patient.additions}</p>}
            {recipe.patient.removals && <p className="mt-1 break-words">감: {recipe.patient.removals}</p>}
          </div>
          <p className="mt-3 text-sm leading-6 text-primary/80">약재 탭의 1일 함량을 기준으로, 중복 약재는 가장 많은 용량에 맞춥니다. 기록된 가감이 있으면 적용한 뒤 기간별로 계산합니다.</p>
          {recipe.warnings?.map((warning, index) => <p key={index} className="mt-2 border border-amber-300 bg-amber-50 p-3 text-amber-900">{warning}</p>)}
        </div>

        <div className="border border-primary/25 bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl font-bold">1일 기준 약재량</h3>
            <p className="font-bold">{recipe.herbs.length}종 · 총 {grams(totalDaily)}g</p>
          </div>
          <dl className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {recipe.herbs.map(herb => <div key={herb.name} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 border border-primary/10 bg-bg-light px-3 py-2.5">
              <dt className="break-words font-medium">{herb.name}</dt>
              <dd className="whitespace-nowrap font-bold tabular-nums">{grams(herb.dailyGrams)}g</dd>
            </div>)}
          </dl>
        </div>

        <div className="space-y-3">
          {[7, 15, 30].map(days => <details key={`${recipe.fetchedAt}-${days}`} className="group min-w-0 border-2 border-primary/25 bg-white">
            <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-4 marker:content-none [&::-webkit-details-marker]:hidden">
              <ChevronDown size={21} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              <span className="text-xl font-bold">{days}일치</span>
              <span className="ml-auto text-base">총 <strong className="tabular-nums">{grams(totalDaily * days)}g</strong></span>
              <span className="w-full pl-8 text-sm text-primary/75 group-open:hidden">눌러서 약재별 용량 보기</span>
            </summary>
            <div className="border-t border-primary/15 p-3 sm:p-4">
              <p className="mb-3 text-sm text-primary/75">각 약재의 1일 용량 × {days}일</p>
              <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {recipe.herbs.map(herb => <div key={herb.name} className="flex min-w-0 items-center justify-between gap-3 border border-primary/10 bg-bg-light px-3 py-3">
                  <dt className="min-w-0 break-words font-bold">{herb.name}<span className="mt-0.5 block text-sm font-normal text-primary/70">1일 {grams(herb.dailyGrams)}g</span></dt>
                  <dd className="shrink-0 whitespace-nowrap text-lg font-bold tabular-nums">{grams(herb.dailyGrams * days)}g</dd>
                </div>)}
              </dl>
            </div>
          </details>)}
        </div>
      </section>}
    </div>
  );
};
