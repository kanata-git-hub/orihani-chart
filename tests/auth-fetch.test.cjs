const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
test('frontend keeps the request and refreshes its ID token, without sending it to external URLs',async()=>{
 const calls=[];const auth={authStateReady:async()=>{},currentUser:{getIdToken:async()=> 'fresh-token'}};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/authFetch.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};new Function('require','module','exports','fetch',code)(()=>({auth}),m,m.exports,async(...args)=>{calls.push(args);return new Response('{}');});
 const body=JSON.stringify({prompt:'원래 입력',data:'same-image'});
 await m.exports.authFetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body});
 assert.equal(calls[0][1].body,body);assert.equal(calls[0][1].headers.get('Authorization'),'Bearer fresh-token');assert.equal(calls[0][1].headers.get('Content-Type'),'application/json');
 await assert.rejects(m.exports.authFetch('https://external.invalid/api/generate'),/Invalid/);
 auth.currentUser=null;await assert.rejects(m.exports.authFetch('/api/generate'),/로그인/);assert.equal(calls.length,1);
});

test('role checks fail closed across account changes, rejected lookups and sign-out', async () => {
  const state = [];
  let notify;
  let lookup;
  const context = { Provider: 'provider' };
  const react = {
    createContext: () => context,
    createElement: () => null,
    useState(value) {
      const index = state.push(value) - 1;
      return [value, next => { state[index] = next; }];
    },
    useEffect: start => start(),
  };
  const modules = {
    react,
    '../services/firebase': { auth: {}, db: {} },
    '../accountStorage': { initializeDraftOwner() {}, scopedStorage: () => ({ getItem: () => null }) },
    'firebase/auth': { onAuthStateChanged(_auth, callback) { notify = callback; return () => {}; } },
    'firebase/firestore': { doc: () => ({}), getDocFromServer: () => lookup() },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/contexts/AuthContext.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText;
  const m = { exports: {} };
  new Function('require','module','exports','localStorage',code)(id => modules[id], m, m.exports, {});
  m.exports.AuthProvider({ children: null });

  const user = { uid: 'first', email: 'first@example.invalid', emailVerified: true };
  const snapshot = { exists: () => true, data: () => ({ role: 'admin' }) };
  lookup = async () => snapshot;
  await notify(user);
  assert.equal(state[1], 'admin');
  let finish;
  lookup = () => new Promise(resolve => { finish = resolve; });
  const pending = notify({ ...user, uid: 'second', email: 'second@example.invalid' });
  assert.equal(state[1], null);
  await notify(null);
  finish(snapshot);
  await pending;
  assert.equal(state[1], null);
  lookup = async () => { throw Error('unavailable'); };
  await notify(user);
  assert.equal(state[1], null);
  await notify({ ...user, emailVerified: false });
  assert.equal(state[1], null);
});
