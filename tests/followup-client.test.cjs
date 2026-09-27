const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), ts=require('typescript');
function client(request) {
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/aiService.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name.includes('authFetch')?{authFetch:request}:{},module,module.exports);
  return module.exports;
}
test('client sends the selected engine with the unchanged prompt and retains result metadata',async()=>{
  for(const engine of ['gemini','gpt-astra']){
    const result={text:'analysis',engine,model:engine==='gemini'?'gemini-3.6-flash':'gpt-6-astra'};
    const api=client(async(url,options)=>{
      assert.equal(url,'/api/generate-followup');
      assert.deepEqual(JSON.parse(options.body),{prompt:'original prompt',engine});
      return new Response(JSON.stringify(result));
    });
    assert.deepEqual(await api.generateFollowUpAnalysis('original prompt',engine),result);
  }
});
test('client preserves actionable errors and rejects an unexpected provider result',async()=>{
  const missing=client(async()=>new Response(JSON.stringify({error:'OPENAI_NOT_CONFIGURED'}),{status:503}));
  await assert.rejects(missing.generateFollowUpAnalysis('test','gpt-astra'),/OPENAI_NOT_CONFIGURED/);
  const mismatched=client(async()=>new Response(JSON.stringify({text:'other result',engine:'gemini',model:'gemini-3.6-flash'})));
  await assert.rejects(mismatched.generateFollowUpAnalysis('test','gpt-astra'),/INVALID_AI_RESPONSE/);
});
