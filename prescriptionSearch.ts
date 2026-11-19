import { readFile } from 'node:fs/promises';
import { RecipeError } from './prescriptionRecipe.ts';

const compact = (s: unknown) => String(s ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
type Rows = unknown[][];
export function clinicalEvidence(rows: Rows, catalog: Rows, query: string) {
  const headers = (rows[0] ?? []).map(compact);
  const idx = (name: string) => headers.indexOf(compact(name));
  for (const name of ['성함','증상','처방','효과','효과(자세히)']) {
    if (idx(name) < 0) throw new RecipeError('환자 시트의 열 이름을 확인해주세요.');
  }
  const term = compact(query);
  if (!/^[가-힣a-z0-9-]{2,30}$/.test(term) || !/[가-힣a-z]/.test(term) || /[0-9]{3}/.test(term) || rows.slice(1).some(row => {
    const name = compact(row[idx('성함')]);
    return name.length >= 2 && term.includes(name);
  })) throw new RecipeError('환자 정보 없이 증상이나 질병 이름만 입력해주세요.', 400);
  const formulaColumn = (catalog[0] ?? []).map(compact).indexOf('처방명');
  if (formulaColumn < 0) throw new RecipeError('약재 시트의 처방명 열을 확인해주세요.');
  const dictionary = new Map(catalog.slice(1).map(row => [compact(row[formulaColumn]), String(row[formulaColumn] ?? '').trim()]));
  const emptyCounts = {기록:0,좋음:0,보통:0,나쁨:0,판정불명:0,결과미기록:0,상세기록:0,상세악화언급:0,상세호전언급:0,상세불변언급:0,가감기록:0};
  const groups = new Map<string, typeof emptyCounts>();
  let skipped = 0;
  for (const row of rows.slice(1)) {
    if (!compact(row[idx('증상')]).includes(term)) continue;
    const get = (key: string) => String(row[idx(key)] ?? '').trim();
    const entered = [get('처방'), get('처방2'), get('처방3')].filter(Boolean);
    const parts = (entered.length ? entered : [get('처방 조합')]).flatMap(s => s.split(/[+,]/)).map(compact);
    if (parts.some(s => !s || !dictionary.has(s))) { skipped++; continue; }
    const label = parts.map(s => dictionary.get(s)).sort().join(' + ');
    const counts = groups.get(label) ?? {...emptyCounts};
    const result = get('효과'), detail = get('효과(자세히)');
    counts.기록++;
    counts[['좋음','보통','나쁨'].includes(result) ? result : detail || result ? '판정불명' : '결과미기록']++;
    if (detail) counts.상세기록++;
    // Retain only fixed categories. Free-text feedback may identify the patient.
    const phrases = detail.split(/[.,;!?\n]/).map(s => s.trim());
    if (phrases.some(s => /(?:악화됨|악화되심|더 심해짐)$/.test(s))) counts.상세악화언급++;
    if (phrases.some(s => /(?:호전됨|많이 좋아짐|호전되심)$/.test(s))) counts.상세호전언급++;
    if (phrases.some(s => /(?:호전 없음|변화 없음|효과 없음)$/.test(s))) counts.상세불변언급++;
    if ([get('가'),get('감')].some(x=>x && x !== '-')) counts.가감기록++;
    groups.set(label, counts);
  }
  return { groups: Array.from(groups, ([formula,counts]) => ({formula,...counts})), skipped };
}

type Reference = {formula:string, source:string, text:string};
export async function referenceEvidence(query: string, formulas: string[]) {
  const file = process.env.TSUMURA_REFERENCE_JSON;
  if (!file) return {status:'쯔무라 원본 미연결', excerpts:[]};
  const data: Reference[] = JSON.parse(await readFile(file,'utf8'));
  if (!Array.isArray(data) || !data.every(x => x && [x.formula,x.source,x.text].every(v=>typeof v==='string' && v.trim()))) {
    throw new RecipeError('쯔무라 원본의 처방명·출처·본문을 확인해주세요.');
  }
  const names=new Set(formulas.flatMap(s=>s.split(' + ')).map(compact));
  const excerpts=data.filter(x=>compact(x.text).includes(compact(query)) || names.has(compact(x.formula)));
  return {status:excerpts.length?'쯔무라 원본 발췌':'쯔무라 원본에 일치 자료 없음',excerpts};
}
