import type { BookCorpus, BookPage } from './bookGuide.ts';

// This identifies the private worksheet; Google authorizes each request with the
// signed-in user's token. Never cache one reader's access for another reader.
const clinicBookSpreadsheetId = '12guWv7yErZeXLnQpRqD3i9A_7N_n--icDO7GF2KY1k4';
export type PrivateBookSource = { corpus: BookCorpus, notice?: never } | { corpus?: never, notice: string };

export async function readPrivateBooks(token: string): Promise<PrivateBookSource> {
  const id = process.env.PRESCRIPTION_BOOK_SHEET_ID ?? clinicBookSpreadsheetId;
  const unavailable = '임상 서적을 불러오지 못해 이번 검색의 문헌 근거는 쯔무라 제제 설명서로 제한됩니다.';
  if (!/^[\w-]+$/.test(id)) return { notice: unavailable };
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/Books!A2:F`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if ([401, 403, 404].includes(response.status)) {
      return { notice: '연결한 Google 계정으로 임상 서적을 열 수 없어 이번 검색의 문헌 근거는 쯔무라 제제 설명서로 제한됩니다.' };
    }
    if (!response.ok) return { notice: unavailable };
    const { values } = await response.json();
    if (!Array.isArray(values)) return { notice: unavailable };

    const pages: BookPage[] = [];
    const seen = new Set<string>();
    for (const row of values) {
      if (!Array.isArray(row)) return { notice: unavailable };
      if (!row.length || row.every(value => value === '')) continue;
      const [id, book, section, rawPage, text, topics] = row;
      const page = Number(rawPage);
      if (typeof id !== 'string' || !id.trim() || seen.has(id) ||
        typeof book !== 'string' || !book.trim() || typeof section !== 'string' || !section.trim() ||
        !Number.isSafeInteger(page) || page < 1 || typeof text !== 'string' || !text.trim() ||
        (topics !== undefined && typeof topics !== 'string')) return { notice: unavailable };
      seen.add(id);
      pages.push({ id, book, section, page, text, topics });
    }
    return pages.length ? { corpus: { pages } } : { notice: unavailable };
  } catch {
    // Google errors may contain request details; keep them out of logs and responses.
    return { notice: unavailable };
  }
}
