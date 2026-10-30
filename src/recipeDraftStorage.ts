import { scopedStorage } from './accountStorage.ts';

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

export interface RecipeResult {
  patient: PrescriptionPatient;
  herbs: Array<{ name: string; dailyGrams: number }>;
  warnings?: string[];
  fetchedAt: string;
}

export interface RecipeDraft {
  name: string;
  gender: string;
  symptoms: string;
  patients: PrescriptionPatient[];
  hasSearched: boolean;
  selectedId: string | null;
  recipe: RecipeResult | null;
  openDays: number[];
}

export type RecipeDraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const RECIPE_DRAFT_KEY = 'prescriptionRecipeDraft';
const MAX_CACHE_LENGTH = 2_000_000;

export function emptyRecipeDraft(): RecipeDraft {
  return { name: '', gender: '', symptoms: '', patients: [], hasSearched: false, selectedId: null, recipe: null, openDays: [] };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 20_000): value is string => typeof value === 'string' && value.length <= limit;
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const textList = (value: unknown, limit: number): value is string[] => Array.isArray(value) && value.length <= limit && value.every(item => text(item));

function patient(value: unknown): PrescriptionPatient | null {
  if (!record(value)) return null;
  const fields = ['id', 'name', 'chartNumber', 'age', 'gender', 'symptoms', 'date', 'dateLabel', 'prescription', 'additions', 'removals'] as const;
  if (!fields.every(field => text(value[field])) || !value.id || !value.name || !positiveInteger(value.rowNumber) || !positiveInteger(value.recordCount) || !textList(value.formulas, 100)) return null;
  // Copy only the expected fields. Tokens, errors and other accidental metadata never enter this cache.
  return {
    id: value.id as string, name: value.name as string, chartNumber: value.chartNumber as string,
    age: value.age as string, gender: value.gender as string, symptoms: value.symptoms as string,
    date: value.date as string, dateLabel: value.dateLabel as string, rowNumber: value.rowNumber,
    prescription: value.prescription as string, formulas: [...value.formulas], additions: value.additions as string,
    removals: value.removals as string, recordCount: value.recordCount,
  };
}

function recipe(value: unknown): RecipeResult | null {
  if (!record(value)) return null;
  const selectedPatient = patient(value.patient);
  if (!selectedPatient || !text(value.fetchedAt, 100) || !Number.isFinite(Date.parse(value.fetchedAt)) || !Array.isArray(value.herbs) || !value.herbs.length || value.herbs.length > 500) return null;
  const herbs: RecipeResult['herbs'] = [];
  const names = new Set<string>();
  for (const herb of value.herbs) {
    if (!record(herb) || !text(herb.name, 200) || !herb.name || names.has(herb.name) || typeof herb.dailyGrams !== 'number' || !Number.isFinite(herb.dailyGrams) || herb.dailyGrams <= 0) return null;
    names.add(herb.name);
    herbs.push({ name: herb.name, dailyGrams: herb.dailyGrams });
  }
  if (value.warnings !== undefined && !textList(value.warnings, 100)) return null;
  return { patient: selectedPatient, herbs, ...(value.warnings ? { warnings: [...value.warnings as string[]] } : {}), fetchedAt: value.fetchedAt };
}

function validatedDraft(value: unknown): RecipeDraft | null {
  if (!record(value) || !text(value.name, 100) || !text(value.gender, 20) || !text(value.symptoms, 500) || typeof value.hasSearched !== 'boolean' || !Array.isArray(value.patients) || value.patients.length > 5000 || !Array.isArray(value.openDays) || value.openDays.length > 3 || !value.openDays.every(day => [7, 15, 30].includes(day))) return null;
  if (value.selectedId !== null && !text(value.selectedId, 20_000)) return null;
  const patients: PrescriptionPatient[] = [];
  const ids = new Set<string>();
  for (const entry of value.patients) {
    const parsed = patient(entry);
    if (!parsed || ids.has(parsed.id)) return null;
    ids.add(parsed.id);
    patients.push(parsed);
  }
  if (value.selectedId !== null && !ids.has(value.selectedId as string)) return null;
  const parsedRecipe = value.recipe === null ? null : recipe(value.recipe);
  if (value.recipe !== null && (!parsedRecipe || parsedRecipe.patient.id !== value.selectedId)) return null;
  return {
    name: value.name, gender: value.gender, symptoms: value.symptoms, patients,
    hasSearched: value.hasSearched, selectedId: value.selectedId as string | null,
    recipe: parsedRecipe, openDays: [...new Set(value.openDays as number[])],
  };
}

export function readRecipeDraft(store: RecipeDraftStore | null, uid: string | null): RecipeDraft | null {
  if (!store || !uid) return null;
  try {
    const raw = scopedStorage(store, uid).getItem(RECIPE_DRAFT_KEY);
    if (!raw || raw.length > MAX_CACHE_LENGTH) return null;
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.version !== 1) return null;
    return validatedDraft(saved.draft);
  } catch { return null; }
}

export function writeRecipeDraft(store: RecipeDraftStore | null, uid: string | null, value: RecipeDraft): boolean {
  if (!store || !uid) return false;
  try {
    const draft = validatedDraft(value);
    if (!draft) return false;
    const raw = JSON.stringify({ version: 1, draft });
    if (raw.length > MAX_CACHE_LENGTH) return false;
    scopedStorage(store, uid).setItem(RECIPE_DRAFT_KEY, raw);
    return true;
  } catch { return false; }
}

export function clearRecipeDraft(store: RecipeDraftStore | null, uid: string | null): boolean {
  if (!store || !uid) return false;
  try { scopedStorage(store, uid).removeItem(RECIPE_DRAFT_KEY); return true; }
  catch { return false; }
}
