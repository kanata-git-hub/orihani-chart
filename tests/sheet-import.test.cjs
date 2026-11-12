const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'src/components/FollowUpTab.tsx'), 'utf8');
const headers = ['성함', '번호', '나이', '성별', '상태', '현재/총기간', '결제일', '배송일',
  '1차 문자발송', '1차', '2차 문자발송', '2차', '증상', '처방', '처방2', '처방3',
  '가', '감', '처방 조합', '테스트T', '테스트U', '효과', '효과(자세히)'];

function row(overrides) {
  const values = { 성함: '합성환자', 번호: 'synthetic-001', 나이: '40', 성별: '남',
    증상: '합성증상', 처방: '합성처방', 배송일: '2026-01-01', ...overrides };
  const result = headers.map(header => values[header] ?? '');
  // Sheets omits trailing empty cells, including V/W when no feedback was entered.
  while (result.length && result.at(-1) === '') result.pop();
  return result;
}

const rows = [headers,
  row({ '현재/총기간': '1/4', 효과: ' 좋음 ', '효과(자세히)': ' 합성 상세 피드백\n둘째 줄 ' }),
  row({ '현재/총기간': '2/4', 효과: '종결' }),
  row({ '현재/총기간': '3/4', '효과(자세히)': '상세 내용만 있음' }),
  row({ '현재/총기간': '4/4' }),
  row({ 성함: '다른합성환자', 효과: '섞이면 안 되는 이름' }),
  row({ 성별: '여', 효과: '섞이면 안 되는 성별' }),
  row({ 증상: '다른증상', 효과: '증상 필터 제외' }),
];

function compile(source, filename = 'test.ts') {
  return ts.transpileModule(source, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
}

function sheetEndpoint(source = serverSource) {
  // Execute the real registered handler without starting other routes or remote services.
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  let handler;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.post' &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/fetch-google-sheet') {
      handler = node.arguments[1].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler, 'sheet import route must exist');
  const requests = [];
  let credentials;
  const google = {
    auth: { OAuth2: class { setCredentials(value) { credentials = value; } } },
    sheets: () => ({ spreadsheets: { values: { get: async request => {
      requests.push(request);
      assert.deepEqual(credentials, { access_token: 'synthetic-google-token' });
      const match = /^한약환자!A1:([A-Z]+)$/.exec(request.range);
      assert.ok(match, 'expected a bounded patient-sheet read');
      const width = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
      // Honor the requested range: an A:U request really loses V and W.
      return { data: { values: rows.map(cells => cells.slice(0, width)) } };
    } } } }),
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compile(`module.exports = ${handler};`))(
    id => { assert.equal(id, 'googleapis'); return { google }; }, module, module.exports);
  return {
    requests,
    async request(body) {
      let status = 200;
      let response;
      const res = { status(value) { status = value; return this; }, json(value) { response = value; return this; } };
      await module.exports({ body }, res);
      return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
    },
  };
}

async function importInClient(endpoint, source = clientSource) {
  let saved = { 1: { briefing: { patientName: '합성환자', gender: '남', age: '', mainSymptom: '합성증상',
    patientPattern: '', memo: '', records: [{ id: 'old', response: '' }] } } };
  const errors = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: value => [value, next => { if (typeof next === 'string') errors.push(next); }],
  };
  const modules = {
    react,
    '../authFetch': { authFetch: async (url, options) => {
      assert.equal(url, '/api/fetch-google-sheet');
      assert.equal(options.method, 'POST');
      return endpoint.request(JSON.parse(options.body));
    } },
    '../hooks/useFollowUpData': { useFollowUpData: () => ({ followUpData: saved,
      setFollowUpData: update => { saved = update(saved); }, isFollowUpSaved: true }) },
    '../contexts/AuthContext': { useAuth: () => ({ googleAccessToken: 'synthetic-google-token' }) },
    '../services/aiService': {}, '../services/prompts': {},
    './ResetModal': {}, './ErrorModal': {}, './followup/FollowUpForm': {},
    './followup/FollowUpFeedbackPanel': {}, './followup/FollowUpDiagnosisPanel': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compile(source, 'FollowUpTab.tsx'))(
    id => { assert.ok(Object.hasOwn(modules, id), `unexpected client dependency ${id}`); return modules[id]; },
    module, module.exports);
  const tree = module.exports.FollowUpTab({ activeTab: 1 });
  function findImport(node) {
    if (node?.props?.onImportFromSheets) return node.props.onImportFromSheets;
    for (const child of node?.children || []) {
      const callback = findImport(child);
      if (callback) return callback;
    }
  }
  const callback = findImport(tree);
  assert.equal(typeof callback, 'function');
  await callback();
  assert.deepEqual(errors, []);
  return saved[1].briefing;
}

function assertFeedback(briefing) {
  assert.deepEqual(briefing.records.map(record => record.response), [
    '좋음: 합성 상세 피드백\n둘째 줄', '종결', '상세 내용만 있음', '',
  ]);
}

test('sheet import preserves V/W feedback through the real endpoint and client mapping', async () => {
  const endpoint = sheetEndpoint();
  const briefing = await importInClient(endpoint);
  assertFeedback(briefing);
  assert.equal(briefing.age, '40');
  assert.deepEqual(briefing.records.map(record => record.period), ['1/4', '2/4', '3/4', '4/4']);
  assert.ok(briefing.records.every(record => record.prescription === '합성처방'));
  assert.equal(endpoint.requests.length, 1);
  assert.equal(endpoint.requests[0].range, '한약환자!A1:W');
});

test('sheet import keeps name/gender/symptom filtering and requires a Google token', async () => {
  const endpoint = sheetEndpoint();
  const denied = await endpoint.request({ name: '합성환자', gender: '남' });
  assert.equal(denied.status, 401);
  assert.equal(endpoint.requests.length, 0);
  const response = await endpoint.request({ accessToken: 'synthetic-google-token', name: ' 합성환자 ', gender: '남', symptoms: '' });
  assert.equal(response.status, 200);
  const { matches } = await response.json();
  assert.equal(matches.length, 5);
  assert.ok(matches.every(match => match.성함 === '합성환자' && match.성별 === '남'));
  assert.equal(matches.at(-1).효과, '증상 필터 제외');
});

test('regression fixtures detect the original truncated range and detail-only formatting', async () => {
  // Mutate only in-memory source: shared repository files remain unchanged.
  const truncatedSource = serverSource.replace("'한약환자!A1:W'", "'한약환자!A1:U'");
  assert.notEqual(truncatedSource, serverSource);
  const missingFeedback = await importInClient(sheetEndpoint(truncatedSource));
  assert.deepEqual(missingFeedback.records.map(record => record.response), ['', '', '', '']);
  assert.throws(() => assertFeedback(missingFeedback), assert.AssertionError);

  const oldFormatting = clientSource.replace(
    /const finalResponse = [\s\S]*?;/,
    "const finalResponse = resDetail ? `${resBasic}: ${resDetail}` : resBasic;",
  );
  assert.notEqual(oldFormatting, clientSource);
  const malformedFeedback = await importInClient(sheetEndpoint(), oldFormatting);
  assert.equal(malformedFeedback.records[2].response, ': 상세 내용만 있음');
  assert.throws(() => assertFeedback(malformedFeedback), assert.AssertionError);
});
