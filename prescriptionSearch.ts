import { RecipeError } from './prescriptionRecipe.ts';
import type { SheetRows } from './prescriptionRecipe.ts';

const compact = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

type Grade = '좋음' | '보통' | '나쁨';
type Finding = { 평가: Grade, 대상: string, 경과: string, 정도: string, 시점: string };
const grades = new Set<unknown>(['좋음', '보통', '나쁨']);
const isGrade = (v: string): v is Grade => grades.has(v);

// Only these labels, the query-target label, and bounded clinical measurements can
// leave the server. Never copy a clause, arbitrary symptom name, or time/date.
const symptoms: Record<string, string[]> = {
  소화불량:['소화불량','소화','체기','더부룩'], 피로:['피곤','피로','피로감'],
  통증:['통증','동통'], 두통:['두통','머리아픔'], 복통:['복통','배아픔'],
  기침:['기침'], 가래:['가래'], 불면:['불면','잠','수면'], 식욕:['입맛','식욕'],
  오심:['메스꺼','미식거','울렁','오심'], 구토:['구토','토함'], 속쓰림:['속쓰림','속쓰'],
  설사:['설사','묽은변'], 변비:['변비'], 어지럼:['어지럼','어지러','현훈'],
  가려움:['가려움','가려워','가려웠','소양감'], 발진:['발진','두드러기'],
  부종:['부종','부기','붓기'], 빈뇨:['빈뇨','소변횟수'], 야간뇨:['야간뇨'],
  요통:['요통','허리통증'], 슬통:['슬통','무릎통증'], 복만:['복만','복부팽만'],
  구내염:['구내염'], 비염:['비염'], 부작용:['부작용','이상반응'],
};

function targetOf(clause: string, term: string): string {
  const covered: {name:string, word:string}[] = [];
  for (const [name, aliases] of Object.entries(symptoms)) {
    for (const word of aliases) if (clause.includes(word)) covered.push({name,word});
  }
  // 허리통증 is one symptom, not 허리통증 plus a separate 통증 observation.
  const distinct = covered.filter(a => !covered.some(b => a.name !== b.name && b.word.includes(a.word) && b.word.length > a.word.length));
  const labels = new Set(distinct.map(({name}) => name));
  const targetAlias = Object.entries(symptoms).find(([name,aliases]) => name===term || aliases.includes(term))?.[0];
  const explicit = clause.includes(term) || (targetAlias !== undefined && labels.has(targetAlias));
  if (labels.size > 1 || (explicit && labels.size && !labels.has(targetAlias ?? term) && ![...labels].every(l => term.includes(l)))) {
    return '여러 증상 언급·귀속 불명';
  }
  if (explicit) return '검색 증상';
  return labels.size ? '동반·기타: '+[...labels][0] : '대상 미기재';
}

function timeOf(s: string) {
  if (/중단후|끊은후|끊고|끊으니/.test(s)) return '복용 중단 후';
  if (/복용후|먹은후|먹고나서|복약후/.test(s)) return '복용 후';
  if (/복용중|복약중|먹는동안/.test(s)) return '복용 중';
  if (/초반|처음엔|처음에는|복용초기/.test(s)) return '초기';
  if (/최근|지금|현재|요즘|이후|나중/.test(s)) return '최근·이후';
  if (/당시|예전|이전|종전/.test(s)) return '이전';
  return '시점 미기재';
}

function measurement(s: string): {degree:string, course:string} | undefined {
  const arrow = '(?:에서|→|->|⇒|=>)';
  const score = s.match(new RegExp('(?:nrs|vas|통증점수|통증강도)[:=]?(10|[0-9])점?'+arrow+'(10|[0-9])(?:점|(?=[^0-9]|$))'));
  const frequency = s.match(new RegExp('(하루|일일|야간|주당|일주일에)([0-9]{1,2})회?'+arrow+'([0-9]{1,2})회'));
  if (score || frequency) {
    const a = Number(score ? score[1] : frequency![2]), b = Number(score ? score[2] : frequency![3]);
    const unit = score ? '점' : '회';
    const scale = score ? '강도 ' : frequency![1]+' 빈도 ';
    return {degree:scale+a+unit+'→'+b+unit,course:a===b?'수치 불변':a>b?'수치 감소':'수치 증가'};
  }
  return undefined;
}

function extent(s: string) {
  const pct = s.match(/(?<![\d.])(\d{1,2}|100)\s*%(?:정도|가량|쯤|이상|정도는)?(?:호전|개선|감소|줄|나아|좋아|악화|심해)/) ??
    s.match(/(?:호전|개선|감소|악화)(?:정도|율|률|은|는|이|가|됨)?[:=]?(\d{1,2}|100)%(?!\d)/);
  if (pct) return Number(pct[1])+'%';
  if (/절반|반정도|반으로/.test(s)) return '약 절반';
  if (/완전|소실|사라[지졌]|없어[지졌]|거의없/.test(s)) return '거의 또는 완전히';
  if (/대부분|뚜렷|현저|확연|많이|크게|상당히/.test(s)) return '뚜렷하게';
  if (/미미|조금|일부|약간|다소|살짝|부분/.test(s)) return '일부·경미하게';
  return '정도 미기재';
}

function qualitativeCourse(s: string): string | undefined {
  // A reported hypothesis or an explicitly negated improvement must not
  // become a positive observation just because the sentence contains 호전.
  if (/호전된(?:것은|건|것이)?아니|(?:개선|호전|완화)(?:되지|하지)(?:는|도)?않|(?:좋아졌|나아졌)(?:다고보기|다기|다는것은)(?:는)?어려/.test(s)) return '호전 없음';
  if (/같기도|모르겠|불분명|불확실|확인어려|애매|판단어려|좋아진건지|호전여부|관찰필요/.test(s)) return '판단 불확실';
  if (/(?:악화|심해지|나빠지)(?:되|하|지|진|였|한|된|하지|되지|지는|지는요){0,3}(?:않|안|없)|악화(?:는|가)?없/.test(s)) return '악화 부인';
  if (/(?:호전|개선|완화|효과|차도|변화)(?:은|는|이|가|도)?(?:거의|별로|전혀|뚜렷하게)?(?:없|안|되지않|되지도않|되지못|하지않|하지못)|(?:좋아지|나아지|줄어들)(?:지|진|지는)?않|안좋아|안나아|효과못/.test(s)) return '호전 없음';
  if (/부작용|이상반응/.test(s) && /없|않|무증상/.test(s)) return '이상반응 없음 언급';
  if (/재발|다시(?:심|아프|불편|나빠|발생|시작)|도로심/.test(s)) return '재발';
  if (/그대로|변함없|비슷|동일|여전|계속(?:됨|있)|지속|남아|잔존/.test(s)) return '불변·잔존';
  if (/악화|심해[지졌짐]|나빠[지졌짐]|더불편|더아프/.test(s)) return '악화';
  if (/생[겼김]|발생|새로생|새로시작/.test(s)) return '새로 발생';
  if (/호전|개선|완화|좋아[지졌짐요]|나아[지졌짐]|덜해|덜함|줄었|줄어듦|줄어듬|감소|소실|사라[지졌짐]|없어[지졌짐]|괜찮아[지졌짐]|많이좋음|거의없어/.test(s)) return '호전';
  if (/복용중단|복약중단|먹지못|복용못|복용불가/.test(s)) return '복용 중단·곤란';
  return undefined;
}

const hiddenClause='[일부 문맥 비공개]';
const wordForms = new Set<string>();
const nounEndings=['','이','가','은','는','을','를','도','만','까지','부터','보다','에서','에','으로','로','와','과','에는','에서는','정도','정도는','까지는','으로는','만큼','마다'];
const clinicalNouns=[...Object.keys(symptoms),...Object.values(symptoms).flat(),'통증점수','강도','횟수','빈도','배변','수면시간','식사량','복용','치료','중단','효과','양상','증상','반응','정도','변화','차이','차도','상태','처음','초기','최근','이전','지금','현재','평소','낮','밤','아침','저녁','오후','오전','야간','식전','식후','하루','당일','일주일','첫날','며칠','절반','반','일부','대부분','무변화','유지','소실','호전','개선','완화','악화','감소','증가','재발','불편감','부담','소화기','위장','위통','두근거림','가슴답답함','기력','졸음','졸림','각성'];
for(const word of clinicalNouns) for(const ending of nounEndings) wordForms.add(word+ending);
const verbStems=['좋아지','나아지','심해지','줄어들','덜하','지속되','남','없어지','낫','떨어지','호전되','개선되','완화되','악화되','감소하','증가하','나빠지','사라지','괜찮아지','불편하','비슷하','재발하','발생하','편해지','불확실하'];
for(const word of verbStems) for(const ending of ['지','지는','지는지','진','면','며','고','지만','거나','지도','다가','는','는데','는지','는지는','기','기엔']) wordForms.add(word+ending);
const conjugated=['호전됨','호전됐','호전되었','호전되셨','호전된','악화됨','악화됐','악화되었','악화되셨','악화된','개선됐','완화됐','심해졌','좋아졌','나아졌','줄었','늘었','떨어졌','나빠졌','사라졌','없어졌','덜해졌','괜찮아졌','편해졌','불편했','재발했','남았','중단했','생겼','변했','복용했','있었','없었','않았','않으셨','못했','같았','지속됐','비슷했','그랬'];
for(const word of conjugated) for(const ending of ['','음','다고','다','습니다','어요','고','으나','지만','는데','다가','으며','다는','으며도']) wordForms.add(word+ending);
const fixedWords='전혀 거의 별로 뚜렷하게 확실히 많이 조금 일부만 가끔 간혹 여전히 아직 점차 서서히 상당히 심하게 살짝 다소 잠시 잠깐 오히려 다시 갑자기 크게 계속 잘 더 덜 덜함 덜해 훨씬 약간 현저하게 평소보다 복용후 복용전 초반 이후 이전보다 처음엔 최근에는 먹고 복용하고 끊고 끊은 중 후 전 한 뒤 이후부터 이후에는 지나서 때 때만 때는 때마다 중에는 후에는 전에는 정도로 반으로 반만 완전히 부분적으로 절반가량 절반정도 한동안 없어짐 좋아짐 나아짐 심해짐 줄어듦 줄어듬 늘어남 떨어짐 괜찮음 비슷 비슷함 비슷하다 그대로 느낌 듯 같음 같아요 같다고 함 하심 하셨음 하셨다 하심요 있다고 있다고함 없다 없음 없어 없어요 있음 있어 있음요 있음에도 아니고 아니다 아님 아니라고 아니었음 않았음 않았어요 않음 않아요 않는다 않지만 않으나 않고 안 못 있지는 없지는 했음 했다 합니다 됨 됩니다 되지 되지는 되진 된 않은 것이 것은 건 만큼 불명 불확실 애매함 모르겠음 모르겠다고 판단하기 어려움 애매해서 호전없음 효과없음 변화없음 변화없어요 호전되심 호전됨 악화됨 변화없이 부작용없이 못함 이지만 지만 그러나 하지만 다만 반면 그리고'.split(' ');
for(const w of fixedWords) wordForms.add(w);

function feedbackClauses(text:string) {
  return text.normalize('NFKC').toLowerCase()
    .replace(/((?:됐|되었|되셨|졌|었|았|없|있|줄었)고|하지만|지만|으나|는데|하며|되고)(?=\s)/g,'$1;')
    .split(/(?<!\d)\.|\.(?!\d)|[,;!?/\n。]/).map(s=>s.trim()).filter(Boolean);
}

// Every emitted word must match a complete clinic vocabulary entry, or a
// bounded measurement with an explicit clinical unit. Never redact in place:
// a missing modifier or negation could reverse the meaning of an excerpt.
function safeClinicalClauses(clauses:string[],names:Set<string>) {
  const result:string[]=[];
  let usable=false;
  for(const clause of clauses) {
    const joined=compact(clause);
    const nameFound=[...names].some(n=>joined.includes(n));
    const words=clause.split(/\s+/);
    let safe=!!words.length && !nameFound && words.length<=40;
    const output:string[]=[];
    let hasContent=false;
    for(let i=0;safe && i<words.length;i++) {
      const word=words[i];
      if(wordForms.has(word)) {
        output.push(word);
        if(clinicalNouns.some(noun=>word.startsWith(noun)) || qualitativeCourse(compact(word))) hasContent=true;
        continue;
      }
      if (/^(nrs|vas)[:=]?$/.test(word) && /^(?:10|[0-9])(?:점)?(?:→|->|에서)(?:10|[0-9])(?:점)?$/.test(words[i+1]??'')) {
        output.push(word.replace(/[:=]$/,'').toUpperCase(),words[++i].replace(/->/,'→'));
        hasContent=true;
        continue;
      }
      if(/^(?:[0-9]|[1-9][0-9]|100)%(?:정도|가량|쯤|이상|이하|만|로|에서|까지)?$/.test(word)
        || /^(?:[1-9]|[1-9][0-9])(?:회|차례|일째|주째|주간|일간|시간|분)(?:에|만|째|부터|정도|마다|후|간|에서|으로|로|까지)?$/.test(word)) {
        output.push(word);continue;
      }
      safe=false;
    }
    if(safe && hasContent) {result.push(output.join(' '));usable=true;}
    else if(result.at(-1)!==hiddenClause) result.push(hiddenClause);
  }
  return usable?result:[];
}

function summarizeFeedback(clauses:string[], term:string, grade:Grade) {
  const unique = new Map<string, Finding>();
  // Conjunctions start a fresh attribution scope. An unlabelled outcome is
  // retained with its target unknown rather than inherited from the chart C/C.
  for (const clause of clauses) {
    const s=compact(clause);
    if (!s) continue;
    const numeric=measurement(s);
    const course=qualitativeCourse(s);
    const target=targetOf(s,term);
    const add=(경과:string,정도:string)=>{
      const finding={평가:grade,대상:target,경과,정도,시점:timeOf(s)};
      unique.set(JSON.stringify(finding),finding);
    };
    if (numeric) add(numeric.course,numeric.degree);
    if (course) add(course,['호전','악화'].includes(course)?extent(s):'정도 미기재');
  }
  return [...unique.entries()];
}

type ClinicalNote={평가:Grade,내용:string[],건수:number};
type Group = {기록:number, 좋음:number, 보통:number, 나쁨:number, 상세기록:number, 상세미기록:number, 상세해석불가:number, 가감기록:number, details: Map<string, Finding & {건수:number}>, notes:Map<string,ClinicalNote>};
export function clinicalEvidence(rows: SheetRows, catalog: SheetRows, query: string) {
  const headers = (rows[0] ?? []).map(compact);
  const idx = (name: string) => headers.indexOf(compact(name));
  for (const name of ['성함','증상','처방','효과','효과(자세히)']) {
    if (idx(name) < 0) throw new RecipeError('환자 시트의 열 이름을 확인해주세요.');
  }
  const term=compact(query);
  const names=new Set(rows.slice(1).map(row=>compact(row[idx('성함')])).filter(n=>n.length>=2));
  if (!/^[가-힣a-z0-9-]{2,30}$/.test(term) || !/[가-힣a-z]/.test(term) || /[0-9]{3}/.test(term) || [...names].some(n=>term.includes(n))) {
    throw new RecipeError('환자 정보 없이 증상이나 질병 이름만 입력해주세요.',400);
  }
  const col=(catalog[0]??[]).map(compact).indexOf('처방명');
  if (col<0) throw new RecipeError('약재 시트의 처방명 열을 확인해주세요.');
  const dictionary=new Map(catalog.slice(1).map(row=>[compact(row[col]),String(row[col]??'').trim()]));
  const groups=new Map<string,Group>();
  const excluded={미정:0,종결:0,결과미기록:0,기타:0};
  let skipped=0;
  for (const row of rows.slice(1)) {
    const get=(name:string)=>String(row[idx(name)]??'').trim();
    if (!compact(get('증상')).includes(term)) continue;
    const v=get('효과');
    if (!isGrade(v)) {
      const bucket=v==='미정'||v==='종결'?v:v?'기타':'결과미기록';
      excluded[bucket]++;
      continue;
    }
    const split=['처방','처방2','처방3'].map(get).filter(Boolean);
    const parts=(split.length?split:[get('처방 조합')]).flatMap(x=>x.split(/[+,]/)).map(compact);
    if(parts.some(x=>!x || !dictionary.has(x))){skipped++;continue;}
    const formula=parts.map(x=>dictionary.get(x)).sort().join(' + ');
    const group:Group=groups.get(formula)??{기록:0,좋음:0,보통:0,나쁨:0,상세기록:0,상세미기록:0,상세해석불가:0,가감기록:0,details:new Map(),notes:new Map()};
    group.기록++;
    group[v]++;
    if ([get('가'),get('감')].some(x=>x && !/^(?:없음|없다|해당없음|[-–—])$/.test(compact(x)))) group.가감기록++;
    const detail=get('효과(자세히)');
    if (!detail || /^[-–—]$/.test(detail)) group.상세미기록++;
    else {
      group.상세기록++;
      const clauses=feedbackClauses(detail);
      const findings=summarizeFeedback(clauses,term,v);
      const note=safeClinicalClauses(clauses,names);
      if(note.length) {
        const key=JSON.stringify([v,note]), existing=group.notes.get(key);
        if(existing) existing.건수++;
        else group.notes.set(key,{평가:v,내용:note,건수:1});
      }
      if(!findings.length && !note.length) group.상세해석불가++;
      for (const [key,finding] of findings) {
        const existing=group.details.get(key);
        if(existing) existing.건수++;
        else group.details.set(key,{...finding,건수:1});
      }
    }
    groups.set(formula,group);
  }
  return {groups:Array.from(groups,([formula,g])=>({...g,formula,details:[...g.details.values()],notes:[...g.notes.values()]})),skipped,excluded};
}
