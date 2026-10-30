import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-app-token-long-enough' };

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), 'chart-recipe-'));
  const preload = join(directory, 'mock.mjs');
  const trace = join(directory, 'requests.jsonl');
  await writeFile(preload, `
    import assert from 'node:assert/strict';
    import { appendFileSync } from 'node:fs';
    const trace = ${JSON.stringify(trace)};
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const header = ['성함','번호','나이','성별','상태','현재/총기간','결제일','배송일','1차 문자발송','1차','2차 문자발송','2차','증상','처방','처방2','처방3','가','감','처방 조합'];
    let patientReads = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url instanceof Request ? url.url : url);
      if (target.includes('identitytoolkit.googleapis.com')) return reply({ users: [{ localId: 'synthetic-recipe-user', email: 'recipe-test@example.invalid', emailVerified: true }] });
      if (target.includes('firestore.googleapis.com') && target.includes('/users/')) return reply({ fields: { role: { stringValue: 'user' } } });
      if (!target.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) throw Error('Unexpected remote service');
      const method = options.method || 'GET';
      const range = decodeURIComponent(target.split('/values/')[1] || '');
      appendFileSync(trace, JSON.stringify({ method, range, hasBody: !!options.body }) + '\\n');
      assert.equal(method, 'GET');
      assert.equal(options.body, undefined);
      const token = new Headers(options.headers).get('Authorization');
      if (token === 'Bearer synthetic-expired-google') return reply({ error: 'upstream token detail' }, 401);
      if (token === 'Bearer synthetic-forbidden-google') return reply({ error: 'upstream private details' }, 403);
      if (token === 'Bearer synthetic-failed-google') throw Error('upstream secret detail');
      assert.ok(['Bearer synthetic-google', 'Bearer synthetic-missing-formula'].includes(token));
      if (range === "'한약환자'!A1:V") {
        patientReads++;
        const formula = token === 'Bearer synthetic-missing-formula' ? '없는처방' : patientReads > 1 ? '테스트처방나' : '테스트처방가';
        return reply({ values: [header, ['테스트환자','101','40','여','','','2026-10-30','','','','','','테스트증상',formula]] });
      }
      if (range === "'약재'!A1:D") return reply({ values: [['번호','처방명','약재명','함량'],[1,'테스트처방가','테스트약재',2],[2,'테스트처방나','테스트약재',5]] });
      throw Error('Unexpected sheet range');
    };
  `);
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['--experimental-strip-types', '--import', preload, 'server.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), GEMINI_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stderr.on('data', value => { logs += value; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('Server startup timeout: ' + logs)); }, 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(Error('Server exited: ' + code + ' ' + logs)); });
    child.stdout.on('data', value => {
      if (String(value).includes('Production Server running')) { clearTimeout(timeout); resolve(); }
    });
  });
  return {
    request: (endpoint, body, auth = true) => fetch(`http://127.0.0.1:${port}/api/${endpoint}`, {
      method: 'POST', headers: auth ? headers : { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    requests: async () => (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    close: async () => {
      child.kill();
      await once(child, 'exit');
      // This temporary directory was created by this test, not supplied by a caller.
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('recipe routes enforce app login, no-store, live re-read and read-only sheet requests', async () => {
  const server = await startServer();
  try {
    for (const endpoint of ['prescription-patients', 'prescription-recipe']) {
      const unauthorized = await server.request(endpoint, { accessToken: 'synthetic-google', name: '테스트환자', patientId: 'chart:101' }, false);
      assert.equal(unauthorized.status, 401);
      assert.equal(unauthorized.headers.get('Cache-Control'), 'no-store');
    }
    const search = await server.request('prescription-patients', { accessToken: 'synthetic-google', name: '테스트환자' });
    assert.equal(search.status, 200);
    assert.equal(search.headers.get('Cache-Control'), 'no-store');
    const searchData = await search.json();
    assert.deepEqual(searchData.patients[0].formulas, ['테스트처방가']);
    const recipe = await server.request('prescription-recipe', {
      accessToken: 'synthetic-google', patientId: searchData.patients[0].id,
      // None of these caller-provided values may override live sheet data.
      formulas: ['테스트처방가'], additions: '테스트약재 99g', herbs: [{ name: '테스트약재', dailyGrams: 999 }],
    });
    assert.equal(recipe.status, 200);
    assert.equal(recipe.headers.get('Cache-Control'), 'no-store');
    const recipeData = await recipe.json();
    assert.deepEqual(recipeData.patient.formulas, ['테스트처방나']);
    assert.deepEqual(recipeData.herbs, [{ name: '테스트약재', dailyGrams: 5 }]);
    assert.ok(!Number.isNaN(Date.parse(recipeData.fetchedAt)));
    const requests = await server.requests();
    assert.equal(requests.filter(request => request.range === "'한약환자'!A1:V").length, 2);
    assert.equal(requests.filter(request => request.range === "'약재'!A1:D").length, 1);
    assert.ok(requests.every(request => request.method === 'GET' && !request.hasBody));
  } finally { await server.close(); }
});

test('recipe errors are uncached, preserve token-expiry semantics, and never expose partial data or upstream detail', async () => {
  const server = await startServer();
  try {
    for (const [body, status] of [
      [{ patientId: 'chart:101' }, 401],
      [{ accessToken: 'synthetic-google', patientId: 'bad-selection' }, 400],
      [{ accessToken: 'synthetic-expired-google', patientId: 'chart:101' }, 401],
      [{ accessToken: 'synthetic-forbidden-google', patientId: 'chart:101' }, 403],
      [{ accessToken: 'synthetic-failed-google', patientId: 'chart:101' }, 502],
      [{ accessToken: 'synthetic-missing-formula', patientId: 'chart:101' }, 422],
    ]) {
      const response = await server.request('prescription-recipe', body);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const data = await response.json();
      assert.equal(typeof data.error, 'string');
      assert.equal(data.herbs, undefined);
      assert.equal(data.patient, undefined);
      assert.doesNotMatch(JSON.stringify(data), /synthetic-|upstream|secret|private details/);
    }
    const emptyName = await server.request('prescription-patients', { accessToken: 'synthetic-google', name: '' });
    assert.equal(emptyName.status, 400);
    assert.equal(emptyName.headers.get('Cache-Control'), 'no-store');
  } finally { await server.close(); }
});
