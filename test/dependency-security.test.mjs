import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { validateExtractionResult } from '../lib/extraction-schema.mjs';
import { coerceExtractionResult } from '../lib/extraction-prompt.mjs';

const require = createRequire(import.meta.url);

test('oversized invalid aliases stop at their declared bound while ordinary extraction remains valid', () => {
  const value = { entities: [{ name: 'owned', type: 'project', salience: 0.5, aliases: Array(64).fill(1) }],
    themes: [], actions: [], decisions: [], friction_signals: [], relationships: [] };
  assert.throws(() => validateExtractionResult(value), error => error.issues.length === 1
    && error.issues[0].code === 'too_big');
  value.entities[0].aliases = ['one', 'two'];
  assert.deepEqual(validateExtractionResult(value), value);
  value.entities[0].aliases = Array(64).fill('owned');
  assert.equal(validateExtractionResult(coerceExtractionResult(value)).entities[0].aliases.length, 10);
});

test('oversized invalid map/set inputs stop before accumulating element errors', () => {
  for (const [schema, bad, good] of [
    [z.set(z.string()).max(2), new Set([1, 2, 3, 4]), new Set(['a', 'b'])],
    [z.map(z.string(), z.string()).max(2), new Map([[1, 1], [2, 2], [3, 3]]), new Map([['a', 'b']])],
  ]) {
    const result = schema.safeParse(bad);
    assert.equal(result.success, false); assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, 'too_big'); assert.equal(schema.safeParse(good).success, true);
  }
});

test('compressed JSON handles delayed trailing data, invalid charset, and an ordinary request', () => {
  const script = `const http=require('node:http'),z=require('node:zlib');
const onFinished=require('on-finished'),mode=process.argv[2];
const parser=require(process.argv[1]).json(mode==='invalid-charset'?{verify(){}}:{});
const bad=mode!=='gzip',invalid=mode==='invalid-charset';
const bytes=(mode==='delayed-tail'?z.deflateSync:z.gzipSync)(Buffer.from('{"owned":true}'));
const first=bad?Buffer.concat([bytes,Buffer.from([0])]):bytes;
const tail=mode==='delayed-tail'?Buffer.alloc(1024):invalid?Buffer.alloc(100*1024,0x58):Buffer.alloc(0);
const deadline=setTimeout(()=>process.exit(97),5000);let client;
const server=http.createServer((req,res)=>parser(req,res,error=>{
if(error){res.statusCode=error.status||500;res.end(error.message);return;}
if(mode==='delayed-tail'){onFinished(req,()=>res.end(JSON.stringify(req.body)));client.end(tail);}
else res.end(JSON.stringify(req.body));
}));server.listen(0,'127.0.0.1',()=>{
client=http.request({host:'127.0.0.1',port:server.address().port,method:'POST',agent:false,
headers:{'Content-Type':invalid?'application/json; charset=utf-999':'application/json',
'Content-Encoding':mode==='delayed-tail'?'deflate':'gzip','Content-Length':first.length+tail.length}},res=>{
let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>{
setTimeout(()=>{const expected=invalid?415:200;
if(res.statusCode!==expected||(!invalid&&body!=='{"owned":true}')){
console.error('unexpected response',mode,res.statusCode,body);process.exitCode=99;}
server.close(()=>clearTimeout(deadline));},bad?200:0);});});
client.on('error',error=>{console.error(error);process.exit(98);});
client.setTimeout(3000,()=>client.destroy(new Error('request timeout')));
client.write(first);if(mode!=='delayed-tail')client.end(tail);
});`;
  for (const mode of ['delayed-tail', 'invalid-charset', 'gzip']) {
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', script, require.resolve('body-parser'), mode],
      { encoding: 'utf8', timeout: 7000 });
    assert.equal(result.status, 0, `${mode}: ${result.stderr || result.stdout || result.error?.message}`);
  }
});
