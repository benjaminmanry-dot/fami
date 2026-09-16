import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareDispatch} from './index.js';
const root=fs.mkdtempSync(join(tmpdir(),'fami-dispatch-test-'));
const original={runtime:'acp',agentId:'hermes',mode:'run',streamTo:'parent',model:'openai/gpt-6-astra',task:'fixture',runTimeoutSeconds:180};
const p=prepareDispatch(original,fs,root);
assert.ok(fs.statSync(p.cwd).isDirectory());
assert.equal(p.streamTo,undefined);assert.equal(p.expectsCompletionMessage,true);
assert.equal(p.model,'openai-codex:gpt-6-astra');assert.equal(p.task,'fixture');
assert.equal(original.streamTo,'parent');
assert.equal(prepareDispatch({...p,resumeSessionId:'recorded'},fs,root).cwd,p.cwd);
assert.throws(()=>prepareDispatch({...original,cwd:'/tmp'},fs,root));
assert.throws(()=>prepareDispatch({...original,cwd:join(root,'missing'),resumeSessionId:'unknown'},fs,root));
fs.symlinkSync('/tmp',join(root,'redirect'));
assert.throws(()=>prepareDispatch({...original,cwd:join(root,'redirect')},fs,root));
// Regression: actual Companion seq80 sent empty optional cwd/resume fields.
const empty=prepareDispatch({...original,cwd:'',resumeSessionId:'',model:'openai-codex:gpt-6-astra'},fs,root);
assert.ok(fs.statSync(empty.cwd).isDirectory());
assert.notEqual(empty.cwd,p.cwd);assert.equal(empty.streamTo,undefined);
assert.equal(empty.expectsCompletionMessage,true);assert.equal(empty.resumeSessionId,'');
for(const cwd of [null,' \t\n']) {
  const absent=prepareDispatch({...original,cwd},fs,root);
  assert.ok(fs.statSync(absent.cwd).isDirectory());assert.notEqual(absent.cwd,empty.cwd);
}
for(const cwd of [false,0,{},[],'.',root,join(root,'..','escape'),join(root,'nested','child'),'/tmp',' /tmp '])
  assert.throws(()=>prepareDispatch({...original,cwd},fs,root));
console.log(JSON.stringify({status:'PASS',checks:['fresh-scoped-directory','streaming-cleared','callback-required','native-provider','request-preserved','same-directory-resume','outside-denied','missing-resume-denied','redirect-denied','actual-empty-cwd-regression','null-cwd','whitespace-cwd','non-string-cwd-denied','relative-root-traversal-nested-outside-denied'],model_calls:0,fixture:root}));
