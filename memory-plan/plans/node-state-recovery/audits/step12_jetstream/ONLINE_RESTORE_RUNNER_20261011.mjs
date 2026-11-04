import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { api, capture, cliRestore, copyCold, hashTree, jsonPrivate, openBus, privateDir, writePrivate } from '/Users/moltymac/.codex/worktrees/nats-root-observer/openclaw-nodedev/memory-plan/plans/node-state-recovery/audits/step12_jetstream/recovery.mjs';
process.umask(0o077);
const base = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(base, 'isolated-restore'); assert(!fs.existsSync(target)); privateDir(target);
const token = randomBytes(32).toString('hex');
const servers = [], buses = [], reports = [];
const masters = ['standalone', 'cluster'].map(name => ({ name, hashes: hashTree(path.join(base, name)) }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ports() {
 const held=[];for(let i=0;i<2;i++){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');held.push(s);}const values=held.map(s=>s.address().port);assert(values.every(n=>![4222,4223,4224,6222,6223,6224,8222,8223,8224].includes(n)));await Promise.all(held.map(s=>new Promise(r=>s.close(r))));return values;
}
async function start(name) {
 const [client,monitor]=await ports();const root=path.join(target,name);privateDir(root);const store=path.join(root,'store');privateDir(store);const config=path.join(root,'server.conf');
 writePrivate(config,`server_name: recovery-${name}\nlisten: 127.0.0.1:${client}\nhttp: 127.0.0.1:${monitor}\nauthorization { token: "${token}" }\njetstream { store_dir: "${store}", max_memory_store: 1GB, max_file_store: 2GB }\n`);
 const fd=fs.openSync(config+'.log','wx',0o600);const proc=spawn('/opt/homebrew/bin/nats-server',['--config',config],{stdio:['ignore',fd,fd]});fs.closeSync(fd);const result={client,monitor,proc,root,config};servers.push(result);
 for(let i=0;i<100;i++){if(proc.exitCode!==null)throw Error('Owned restore server exited');try{const r=await fetch(`http://127.0.0.1:${monitor}/healthz?js-enabled-only=true`);if(r.ok)return result;}catch{}await delay(50);}throw Error('Owned restore server not ready');
}
function configCheck(stream, restored) {
 assert.deepEqual(stream.before.config, stream.after.config, 'live config changed around snapshot');
 const archived=structuredClone(stream.snapshot.config);
 assert(!Object.hasOwn(archived,'compression') && !Object.hasOwn(archived,'allow_msg_ttl'));
 archived.compression='none'; archived.allow_msg_ttl=false;
 assert(!Object.hasOwn(archived.metadata||{},'_nats.level') && !Object.hasOwn(archived.metadata||{},'_nats.ver'));
 archived.metadata={...archived.metadata,'_nats.level':'3','_nats.ver':'2.12.6'};
 assert.deepEqual(archived,stream.before.config,'unexpected archive serialization delta');
 assert.deepEqual({...restored,num_replicas:stream.before.config.num_replicas},stream.before.config,'restored config differs from live source');
 return {archiveOmittedDefaults:{compression:'none',allow_msg_ttl:false},archiveOmittedServerMetadata:{'_nats.level':'3','_nats.ver':'2.12.6'}};
}
let passed=false;
try {
 for(const history of masters) {
  const manifest=JSON.parse(fs.readFileSync(path.join(base,history.name,'manifest.json')));const server=await start(history.name);const url=`nats://127.0.0.1:${server.client}`;const nc=await openBus(url,token);buses.push(nc);const report={history:history.name,client:server.client,monitor:server.monitor,startedAt:new Date().toISOString(),streams:[]};
  const ordered=manifest.streams.filter(s=>!s.offline).sort((a,b)=>a.snapshot.config.max_age-b.snapshot.config.max_age);
  for(const stream of ordered) {
   const backup=path.join(server.root,'working-archives',stream.stream);copyCold(path.join(base,history.name,stream.stream),backup);
   await cliRestore('/opt/homebrew/bin/nats',url,token,backup,stream.snapshot.config.num_replicas>1?1:undefined);
   if(stream.snapshot.config.max_age>0){
    const immediately=await api(nc,`$JS.API.STREAM.INFO.${stream.stream}`);const start=Date.now();
    while(Date.now()-start<stream.snapshot.config.max_age/1e6+5000){const info=await api(nc,`$JS.API.STREAM.INFO.${stream.stream}`);if(info.state.messages===0)break;await delay(1000);}
    const aged=await capture(nc,stream.stream);assert.equal(aged.state.messages,0);assert.equal(aged.state.last_seq,stream.snapshot.state.last_seq);const serialization=configCheck(stream,aged.config);
    report.streams.push({stream:stream.stream,ttl:true,serialization,snapshotMessages:stream.snapshot.state.messages,immediatelyRestoredMessages:immediately.state.messages,agedMessages:0,last:aged.state.last_seq,expiryObservedAfterMs:Date.now()-start});
   }else{
    const restored=await capture(nc,stream.stream);const info=await api(nc,`$JS.API.STREAM.INFO.${stream.stream}`);for(const key of ['messages','bytes','first_seq','last_seq','num_deleted'])assert.deepEqual(info.state[key],stream.snapshot.state[key],`${stream.stream} snapshot state ${key}`);for(const key of ['messages','bytes','first_seq','last_seq','num_deleted','deleted']){assert.deepEqual(stream.before.state[key],stream.after.state[key],'source state changed around snapshot');assert.deepEqual(restored.state[key],stream.before.state[key],'restored detailed state differs');}
    const serialization=configCheck(stream,restored.config);
    const originalDurables=stream.consumersBefore.filter(c=>c.config.durable_name),durables=restored.consumers.filter(c=>c.config.durable_name);assert.deepEqual(durables,originalDurables);
    report.streams.push({stream:stream.stream,serialization,snapshotMessages:stream.snapshot.state.messages,last:restored.state.last_seq,first:restored.state.first_seq,content:restored.content,consumers:restored.consumers,isolatedReplicaOverride:stream.snapshot.config.num_replicas>1?1:null});
   }
   console.log(JSON.stringify({history:history.name,stream:stream.stream,restored:true}));
  }
  for(const endpoint of ['routez','leafz','gatewayz']){const info=await(await fetch(`http://127.0.0.1:${server.monitor}/${endpoint}`)).json();if(endpoint==='routez')assert.equal(info.num_routes,0);if(endpoint==='leafz')assert.equal(info.leafnodes,0);if(endpoint==='gatewayz'){assert.equal(Object.keys(info.outbound_gateways||{}).length,0);assert.equal(Object.keys(info.inbound_gateways||{}).length,0);}}
  report.finishedAt=new Date().toISOString();reports.push(report);
 }
 for(const history of masters)assert.deepEqual(hashTree(path.join(base,history.name)),history.hashes);
 passed=true;
}finally{
 for(const nc of buses)await nc.close();
 for(const server of servers){if(server.proc.exitCode===null&&server.proc.signalCode===null){const exited=once(server.proc,'exit');server.proc.kill('SIGTERM');let timer;try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned restore server did not stop')),10000);})]);}finally{clearTimeout(timer);}}assert.match(fs.readFileSync(server.config+'.log','utf8'),/Server Exiting/);}
}
assert(passed);jsonPrivate(path.join(target,'acceptance.json'),{at:new Date().toISOString(),reports,mastersUnchanged:true,allOwnedServersStopped:true});console.log(JSON.stringify({pass:true,target,streams:reports.reduce((n,r)=>n+r.streams.length,0),nonExpiringMessages:reports.flatMap(r=>r.streams).filter(s=>!s.ttl).reduce((n,s)=>n+s.snapshotMessages,0),mastersUnchanged:true,allOwnedServersStopped:true}));
