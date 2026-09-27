import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

// A separate process runs the real production server. All remote calls are synthetic.
async function startServer(withKey) {
  const dir = await mkdtemp(join(tmpdir(), 'chart-followup-'));
  const preload = join(dir, 'mock.mjs');
  await writeFile(preload, `
    import assert from 'node:assert/strict';
    const reply = (body, status=200) => new Response(JSON.stringify(body), {status});
    const generated = '### 1. 🤝 이전 처방 코멘트\\n합성 테스트 결과\\n### 2. 📋 감별 진단 및 추천 처방\\n합성 테스트 절\\n' + '\\x60\\x60\\x60json\\n[{' + '"합방_처방":["테스트처방"]' + '}]\\n\\x60\\x60\\x60';
    globalThis.fetch = async (url, options) => {
      const target = String(url instanceof Request ? url.url : url);
      if (target.includes('identitytoolkit.googleapis.com')) {
        return reply({users:[{localId:'synthetic-user', email:'kanata840@gmail.com', emailVerified:true}]});
      }
      if (target === 'https://api.openai.com/v1/responses') {
        const input = JSON.parse(options.body);
        assert.equal(input.model, 'gpt-6-astra');
        if (input.input === 'incomplete') return reply({status:'incomplete', output:[]});
        if (input.input === 'rate-limit') return reply({error:'redacted'},429);
        return reply({status:'completed', model:'gpt-6-astra', output:[{type:'message',content:[{type:'output_text',text:generated}]}]});
      }
      if (target.startsWith('https://generativelanguage.googleapis.com/')) {
        return reply({candidates:[{content:{role:'model',parts:[{text:generated}]},finishReason:'STOP'}]});
      }
      if (target.startsWith('https://script.google.com/macros/')) {
        assert.deepEqual(JSON.parse(options.body), [{'합방_처방':['테스트처방']}]);
        return reply([{final_recipe:{'테스트약재':2}}]);
      }
      throw Error('Unexpected remote request: '+target);
    };
  `);
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['--experimental-strip-types', '--import', preload, 'server.ts'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV:'production', PORT:String(port), GEMINI_API_KEY:'fake-gemini', OPENAI_API_KEY:withKey ? 'fake-openai' : '' },
    stdio:['ignore','pipe','pipe'],
  });
  let logs = '';
  child.stderr.on('data', value => { logs += value; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('Server startup timeout: '+logs)); }, 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(Error('Server exited: '+code+' '+logs)); });
    child.stdout.on('data', value => { if (String(value).includes('Production Server running')) {clearTimeout(timeout);resolve();} });
  });
  return {url:`http://127.0.0.1:${port}/api/generate-followup`, close:async()=>{child.kill();await once(child,'exit');await rm(dir,{recursive:true,force:true});}};
}

const headers = {'Content-Type':'application/json',Authorization:'Bearer synthetic-token-long-enough'};
test('real follow-up endpoint keeps authentication, engine metadata and herb processing for both providers', async () => {
  const server = await startServer(true);
  try {
    const unauthorized = await fetch(server.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'synthetic',engine:'gpt-astra'})});
    assert.equal(unauthorized.status,401);
    for(const engine of ['gemini','gpt-astra',undefined]) {
      const response = await fetch(server.url,{method:'POST',headers,body:JSON.stringify({prompt:'synthetic',engine})});
      assert.equal(response.status,200);
      const result = await response.json();
      assert.equal(result.engine,engine || 'gemini');
      assert.equal(result.model,engine==='gpt-astra' ? 'gpt-6-astra' : 'gemini-3.1-pro-preview');
      assert.match(result.text,/이전 처방 코멘트/);
      assert.match(result.text,/감별 진단 및 추천 처방/);
      assert.match(result.text,/테스트약재/);
      assert.match(result.text,/30일 기준/);
      assert.doesNotMatch(result.text,/```json/);
    }
    for(const [body,status,code] of [[{prompt:'synthetic',engine:'unknown'},400,'INVALID_ENGINE'],[{prompt:'incomplete',engine:'gpt-astra'},502,'INCOMPLETE_AI_RESPONSE'],[{prompt:'rate-limit',engine:'gpt-astra'},429,'QUOTA_EXCEEDED']]) {
      const response=await fetch(server.url,{method:'POST',headers,body:JSON.stringify(body)});
      assert.equal(response.status,status);assert.equal((await response.json()).error,code);
    }
  } finally { await server.close(); }
});

test('missing OpenAI key produces a clear error while Gemini continues working',async()=>{
  const server=await startServer(false);
  try {
    const gpt=await fetch(server.url,{method:'POST',headers,body:JSON.stringify({prompt:'synthetic',engine:'gpt-astra'})});
    assert.equal(gpt.status,503);assert.equal((await gpt.json()).error,'OPENAI_NOT_CONFIGURED');
    const gemini=await fetch(server.url,{method:'POST',headers,body:JSON.stringify({prompt:'synthetic',engine:'gemini'})});
    assert.equal(gemini.status,200);
  } finally {await server.close();}
});
