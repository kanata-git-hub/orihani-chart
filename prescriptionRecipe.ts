import { createHash } from 'node:crypto';

export type SheetRows = unknown[][];

export interface PrescriptionPatient {
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

export class RecipeError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = 'RecipeError';
    this.status = status;
  }
}

const text = (value: unknown) => value == null ? '' : String(value).trim();
const key = (value: unknown) => text(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const herbKey = (value: unknown) => ['마황', '마황고용량'].includes(key(value)) ? '마황' : key(value);
const ephedraName = (value: unknown) => key(value) === '마황고용량' ? '마황 고용량' : '마황';
const cleanHeader = (value: unknown) => key(value);
const splitFormulas = (value: string) => value.split(/[+＋]/).map(text).filter(Boolean);
const isEmptyModifier = (value: string) => !value || /^(?:없음|없다|해당없음|[-–—])$/.test(value.trim());

function combinedParts(value: string) {
  let formulas = value.normalize('NFKC').trim();
  const modifiers: { additions?: string; removals?: string } = {};
  let invalid = false;
  // Only strip explicitly labelled trailing notes. Unlabelled ratios/instructions
  // remain in the formula text and must never be discarded as decoration.
  while (formulas.endsWith(')')) {
    let depth = 0;
    let start = -1;
    for (let index = formulas.length - 1; index >= 0; index--) {
      if (formulas[index] === ')') depth++;
      else if (formulas[index] === '(' && --depth === 0) { start = index; break; }
    }
    if (start < 0) { invalid = true; break; }
    const body = formulas.slice(start + 1, -1).trim();
    if (!/^(?:가|감)\s*:/.test(body)) break;
    const chunks: string[] = [];
    let chunkStart = 0;
    depth = 0;
    for (let index = 0; index < body.length; index++) {
      if (body[index] === '(') depth++;
      else if (body[index] === ')') depth--;
      else if (body[index] === ',' && depth === 0 && /^\s*(?:가|감)\s*:/.test(body.slice(index + 1))) {
        chunks.push(body.slice(chunkStart, index).trim());
        chunkStart = index + 1;
      }
      if (depth < 0) invalid = true;
    }
    if (depth !== 0) invalid = true;
    chunks.push(body.slice(chunkStart).trim());
    for (const chunk of chunks) {
      const note = chunk.match(/^(가|감)\s*:\s*([\s\S]+)$/);
      if (!note) { invalid = true; continue; }
      const field = note[1] === '가' ? 'additions' : 'removals';
      if (modifiers[field] !== undefined) invalid = true;
      modifiers[field] = text(note[2]);
    }
    formulas = formulas.slice(0, start).trim();
  }
  return { formulas, ...modifiers, invalid };
}

function dateValue(value: string): number {
  const match = value.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?:\s*[.일])?(?:\s.*)?$/);
  if (!match) return 0;
  const [, y, m, d] = match.map(Number);
  const valueMs = Date.UTC(y, m - 1, d);
  const date = new Date(valueMs);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? valueMs : 0;
}

type PatientRecord = PrescriptionPatient & { sortDate: number; combined: string };

function patientRecords(rows: SheetRows): PatientRecord[] {
  if (!rows.length) throw new RecipeError('한약환자 시트에 데이터가 없습니다.');
  const headers = rows[0].map(cleanHeader);
  for (const header of ['성함', '번호', '성별', '증상']) {
    if (!headers.includes(header)) throw new RecipeError(`한약환자 시트의 '${header}' 열을 찾을 수 없습니다.`);
  }
  if (!headers.includes('처방') && !headers.includes('처방조합')) {
    throw new RecipeError('한약환자 시트의 처방 열을 찾을 수 없습니다.');
  }
  const get = (row: unknown[], name: string) => text(row[headers.indexOf(cleanHeader(name))]);
  return rows.slice(1).flatMap((row, index) => {
    const name = get(row, '성함');
    if (!name) return [];
    const rowNumber = index + 2;
    const chartNumber = get(row, '번호');
    const payment = get(row, '결제일');
    const delivery = get(row, '배송일');
    const date = dateValue(payment) ? payment : dateValue(delivery) ? delivery : payment || delivery;
    const dateLabel = dateValue(payment) ? '결제일' : dateValue(delivery) ? '배송일' : '날짜 미확인';
    const combined = get(row, '처방 조합');
    const combinedInfo = combinedParts(combined);
    const enteredFormulas = ['처방', '처방2', '처방3'].flatMap(column => splitFormulas(get(row, column)));
    const formulas = enteredFormulas.length ? enteredFormulas : splitFormulas(combinedInfo.formulas);
    const additions = get(row, '가');
    const removals = get(row, '감');
    let prescription = combined || formulas.join(' + ');
    if (!isEmptyModifier(additions) && combinedInfo.additions === undefined) prescription += ` (가: ${additions})`;
    if (!isEmptyModifier(removals) && combinedInfo.removals === undefined) prescription += ` (감: ${removals})`;
    return [{
      // Numberless rows have no durable patient identity. Bind selection to this exact
      // row content so a row insertion/edit cannot silently select a different person.
      id: chartNumber ? `chart:${chartNumber}` : `row:${rowNumber}:${createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0,16)}`,
      name, chartNumber, age: get(row, '나이'), gender: get(row, '성별'), symptoms: get(row, '증상'),
      date, dateLabel, rowNumber, prescription, formulas, additions, removals, recordCount: 1,
      sortDate: dateValue(date), combined,
    }];
  });
}

function groups(rows: SheetRows): Map<string, PatientRecord[]> {
  const result = new Map<string, PatientRecord[]>();
  for (const patient of patientRecords(rows)) {
    const history = result.get(patient.id) || [];
    history.push(patient);
    result.set(patient.id, history);
  }
  for (const history of result.values()) history.sort((a, b) => b.sortDate - a.sortDate || b.rowNumber - a.rowNumber);
  return result;
}

const publicPatient = (record: PatientRecord, recordCount: number): PrescriptionPatient => {
  const { sortDate, combined, ...patient } = record;
  return { ...patient, recordCount };
};

export function searchPrescriptionPatients(rows: SheetRows, query: { name: string; gender?: string; symptoms?: string }): PrescriptionPatient[] {
  const name = key(query.name);
  if (!name) throw new RecipeError('환자 이름을 입력해주세요.', 400);
  const gender = key(query.gender);
  const symptoms = text(query.symptoms).split(/\s+/).map(key).filter(Boolean);
  const matches: PrescriptionPatient[] = [];
  for (const history of groups(rows).values()) {
    const match = history.some(record => key(record.name).includes(name)
      && (!gender || key(record.gender) === gender)
      && symptoms.every(term => key(record.symptoms).includes(term)));
    if (match) matches.push(publicPatient(history[0], history.length));
  }
  return matches.sort((a, b) => dateValue(b.date) - dateValue(a.date) || b.rowNumber - a.rowNumber);
}

export function getLatestPrescriptionPatient(rows: SheetRows, patientId: string): PrescriptionPatient {
  const history = groups(rows).get(patientId);
  if (!history) throw new RecipeError('선택한 환자를 찾을 수 없습니다. 다시 검색해주세요.', 404);
  return publicPatient(history[0], history.length);
}

function exactGrams(value: unknown, description: string): number {
  const raw = text(value).replace(/\s*(?:g|그램)\s*$/i, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new RecipeError(`${description}의 함량을 확인해주세요. 숫자(g)만 계산할 수 있습니다.`);
  const grams = Number(raw);
  if (!Number.isFinite(grams) || grams <= 0) throw new RecipeError(`${description}의 함량은 0보다 큰 숫자여야 합니다.`);
  return grams;
}

function ephedraPackTarget(part: string): { name: string; perPackGrams: number; dailyGrams: number } | null {
  const normalized = part.normalize('NFKC').trim();
  const prefix = normalized.match(/^([^()]+?)\s*\(/);
  if (!prefix || herbKey(prefix[1]) !== '마황') return null;
  const match = normalized.match(/^([^()]+?)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:g|그램)\s*\)$/i);
  if (!match) throw new RecipeError(`'${part}'의 팩당 마황 용량을 확인해주세요. '마황(5g)' 또는 '마황 고용량(2.5g)'처럼 양수와 g 단위를 입력해주세요.`);
  const perPackGrams = exactGrams(match[2], `${ephedraName(match[1])} 팩당 용량`);
  const dailyGrams = Number((perPackGrams * 2).toFixed(8));
  if (!Number.isFinite(dailyGrams) || dailyGrams <= 0) throw new RecipeError(`'${part}'의 팩당 마황 용량을 계산할 수 없습니다.`);
  return { name: ephedraName(match[1]), perPackGrams, dailyGrams };
}

export function calculatePrescriptionRecipe(patient: PrescriptionPatient, herbRows: SheetRows): { herbs: { name: string; dailyGrams: number }[]; warnings: string[] } {
  if (!patient.formulas.length) throw new RecipeError('가장 최근 기록에 처방이 없습니다. 시트에 처방을 입력한 뒤 다시 조회해주세요.');
  const headers = (herbRows[0] || []).map(cleanHeader);
  const formulaIndex = headers.indexOf('처방명');
  const herbIndex = headers.indexOf('약재명');
  const amountIndex = headers.indexOf('함량');
  if ([formulaIndex, herbIndex, amountIndex].some(index => index < 0)) throw new RecipeError('약재 시트의 처방명·약재명·함량 열을 확인해주세요.');
  const formulaKeys = [...new Set(patient.formulas.map(key))];
  const recipe = new Map<string, { name: string; dailyGrams: number }>();
  const knownHerbs = new Map<string, string>();
  for (const row of herbRows.slice(1)) {
    const herb = text(row[herbIndex]);
    if (herb) knownHerbs.set(herbKey(herb), herb);
  }
  for (const formulaKey of formulaKeys) {
    const formulaRows = herbRows.slice(1).filter(row => key(row[formulaIndex]) === formulaKey);
    const formulaName = patient.formulas.find(formula => key(formula) === formulaKey)!;
    if (!formulaRows.length) throw new RecipeError(`약재 시트에서 '${formulaName}' 처방을 찾지 못했습니다. 처방명이나 비율 표기를 확인해주세요.`);
    const seen = new Set<string>();
    for (const row of formulaRows) {
      const name = text(row[herbIndex]);
      if (!name) throw new RecipeError(`'${formulaName}' 처방에 약재명이 비어 있습니다.`);
      const canonicalHerb = herbKey(name);
      if (seen.has(canonicalHerb)) throw new RecipeError(`'${formulaName}' 처방에 '${name}' 약재가 중복 등록되어 있습니다. 원본 시트를 확인해주세요.`);
      seen.add(canonicalHerb);
      const amount = exactGrams(row[amountIndex], `${formulaName} / ${name}`);
      const current = recipe.get(canonicalHerb);
      if (!current || amount > current.dailyGrams) recipe.set(canonicalHerb, { name, dailyGrams: amount });
    }
  }
  const warnings: string[] = [];
  let ephedraDirectiveSeen = false;
  let ephedraPackTargetSeen = false;
  let hasDailyAdditions = false;
  let hasOrdinaryRemovals = false;
  const claimEphedraDirective = (canonicalHerb: string, isPackTarget = false) => {
    if (canonicalHerb !== '마황') return;
    if (ephedraDirectiveSeen && (ephedraPackTargetSeen || isPackTarget)) throw new RecipeError('마황 지시가 가/감 또는 마황 고용량 별칭으로 중복되어 있습니다. 하나의 마황 지시만 남겨주세요.');
    ephedraDirectiveSeen = true;
    ephedraPackTargetSeen ||= isPackTarget;
  };
  const applyPackTarget = (target: { name: string; perPackGrams: number; dailyGrams: number }, removal = false) => {
    claimEphedraDirective('마황', true);
    if (!knownHerbs.has('마황')) throw new RecipeError(`'${target.name}'를 약재 시트에서 찾지 못했습니다.`);
    if (removal && !recipe.has('마황')) throw new RecipeError(`감(감량 약재) '${target.name}'는 현재 처방에 없습니다. 새로 넣으려면 가 칸에 팩당 용량을 입력해주세요.`);
    // This explicitly configured per-pack target replaces the complete daily amount.
    recipe.set('마황', { name: target.name, dailyGrams: target.dailyGrams });
    warnings.push(`${target.name}: ${target.perPackGrams}g/팩 × 2팩 = ${target.dailyGrams}g/일을 최종량으로 적용했습니다.`);
  };
  const modifierParts = (value: string) => value.normalize('NFKC').split(/[,、;\n]/).map(text).filter(Boolean);
  if (!isEmptyModifier(patient.additions)) {
    const parts = modifierParts(patient.additions);
    if (!parts.length) throw new RecipeError('가(추가 약재) 표기를 확인해주세요.');
    const seen = new Set<string>();
    for (const part of parts) {
      const packTarget = ephedraPackTarget(part);
      if (packTarget) { applyPackTarget(packTarget); continue; }
      const match = part.match(/^([^\d+:：()]+?)\s*[:：]?\s*(\+?)(\d+(?:\.\d+)?)\s*(?:g|그램)?\s*(추가)?$/i);
      if (!match) throw new RecipeError(`가(추가 약재) '${part}'의 용량이 없거나 표기가 올바르지 않습니다. 일반 약재는 '약재명 2g'(1일량), 팩당 마황은 '마황(5g)'처럼 입력해주세요.`);
      const canonicalHerb = herbKey(match[1]);
      claimEphedraDirective(canonicalHerb);
      if (!knownHerbs.has(canonicalHerb)) throw new RecipeError(`가(추가 약재) '${text(match[1])}'를 약재 시트에서 찾지 못했습니다.`);
      if (seen.has(canonicalHerb)) throw new RecipeError(`가(추가 약재)에 '${text(match[1])}'가 중복되어 있습니다.`);
      seen.add(canonicalHerb);
      const extra = exactGrams(match[3], text(match[1]));
      const current = recipe.get(canonicalHerb);
      if (current && !match[2] && !match[4]) throw new RecipeError(`가(추가 약재) '${current.name}'는 이미 처방에 있습니다. 추가량인지 최종량인지 구분할 수 없어 계산을 중단했습니다. 추가하려면 '${current.name} +${extra}g' 또는 '${current.name} ${extra}g 추가'로 명시해주세요.`);
      recipe.set(canonicalHerb, { name: current?.name || (canonicalHerb === '마황' ? ephedraName(match[1]) : knownHerbs.get(canonicalHerb)!), dailyGrams: Number(((current?.dailyGrams || 0) + extra).toFixed(8)) });
      hasDailyAdditions = true;
    }
  }
  if (!isEmptyModifier(patient.removals)) {
    const parts = modifierParts(patient.removals);
    if (!parts.length) throw new RecipeError('감(제외 약재) 표기를 확인해주세요.');
    const seen = new Set<string>();
    for (const part of parts) {
      const packTarget = ephedraPackTarget(part);
      if (packTarget) { applyPackTarget(packTarget, true); continue; }
      const fraction = part.match(/^([^\d()]+?)\s+(\d+)\s*\/\s*(\d+)$/);
      const canonicalHerb = herbKey(fraction ? fraction[1] : part);
      claimEphedraDirective(canonicalHerb);
      if (seen.has(canonicalHerb)) throw new RecipeError(`감(제외 약재)에 '${part}'가 중복되어 있습니다.`);
      seen.add(canonicalHerb);
      if (!recipe.has(canonicalHerb)) throw new RecipeError(`감(제외 약재) '${part}'를 확인해주세요. 현재 레시피의 약재명 또는 '약재명 1/2' 형태의 남길 비율만 계산할 수 있습니다.`);
      const current = recipe.get(canonicalHerb)!;
      if (fraction) {
        const numerator = Number(fraction[2]);
        const denominator = Number(fraction[3]);
        if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator > denominator) {
          throw new RecipeError(`감(감량 약재) '${part}'의 남길 비율은 0에서 1 사이여야 합니다.`);
        }
        const amount = Number((current.dailyGrams * numerator / denominator).toFixed(8));
        if (amount > 0) recipe.set(canonicalHerb, { ...current, dailyGrams: amount });
        else recipe.delete(canonicalHerb);
      } else recipe.delete(canonicalHerb);
      hasOrdinaryRemovals = true;
    }
  }
  if (!recipe.size) throw new RecipeError('가감 후 약재가 남지 않습니다. 처방을 확인해주세요.');
  if (hasDailyAdditions) warnings.push('일반 가: 표기된 g만큼 1일 용량에 추가했습니다.');
  if (hasOrdinaryRemovals) warnings.push('일반 감: 약재명만 있으면 완전 제외, N/D 비율이 있으면 해당 비율만큼 남겼습니다.');
  if (!dateValue(patient.date)) warnings.push('유효한 날짜가 없는 기록은 시트의 아래 행을 최근 기록으로 선택합니다.');
  return { herbs: [...recipe.values()], warnings };
}

export function createPrescriptionRecipe(patientRows: SheetRows, herbRows: SheetRows, patientId: string) {
  const history = groups(patientRows).get(patientId);
  if (!history) throw new RecipeError('선택한 환자를 찾을 수 없습니다. 다시 검색해주세요.', 404);
  const latest = history[0];
  // The combination column may carry a ratio or instruction missing from the three formula columns.
  // Refuse a mismatch rather than silently discarding that instruction.
  const combinedInfo = combinedParts(latest.combined);
  const modifierMismatch = combinedInfo.invalid
    || (combinedInfo.additions !== undefined && key(combinedInfo.additions) !== key(latest.additions))
    || (combinedInfo.removals !== undefined && key(combinedInfo.removals) !== key(latest.removals));
  if (latest.combined && (modifierMismatch || key(combinedInfo.formulas) !== key(latest.formulas.join('+')))) {
    throw new RecipeError('처방 조합과 개별 처방 칸이 서로 다르거나 추가 지시가 있습니다. 시트의 처방·처방2·처방3 및 처방 조합을 확인해주세요.');
  }
  const patient = publicPatient(latest, history.length);
  return { patient, ...calculatePrescriptionRecipe(patient, herbRows) };
}
