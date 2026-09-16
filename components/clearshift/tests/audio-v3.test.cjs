'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
class Param{constructor(value=0){this.value=value;this.events=[];} setValueAtTime(v,t){this.value=v;this.events.push([v,t]);}linearRampToValueAtTime(v,t){this.setValueAtTime(v,t);}exponentialRampToValueAtTime(v,t){this.setValueAtTime(v,t);}cancelScheduledValues(t){this.events=this.events.filter(e=>e[1]<t);}}
class Node{constructor(){for(const p of ['gain','frequency','pan','Q','threshold','knee','ratio','attack','release'])this[p]=new Param();this.disconnected=false;}connect(){return this;}disconnect(){this.disconnected=true;}}
class Source extends Node{constructor(ctx){super();this.ctx=ctx;this.stopped=false;ctx.sources.push(this);}start(at,offset){this.started={at,offset};}stop(){this.stopped=true;}}
const contexts=[];
class Context{constructor(){this.currentTime=0;this.state='suspended';this.destination=new Node();this.sources=[];contexts.push(this);}createGain(){return new Node();}createBiquadFilter(){return new Node();}createDynamicsCompressor(){return new Node();}createStereoPanner(){return new Node();}createBufferSource(){return new Source(this);}createOscillator(){return new Source(this);}async decodeAudioData(bytes){return {duration:new Float64Array(bytes)[0]};}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}}
global.AudioContext=Context;
const ok=async(url)=>({ok:true,arrayBuffer:async()=>new Float64Array([url.includes('00-cut-it-loose')?256*60/122:128*60/112]).buffer});
global.fetch=ok;require('../js/audio.js');
const beat=60/122,oldBeat=60/112,settle=()=>new Promise(r=>setTimeout(r,20));
async function make(){global.fetch=ok;const a=new ClearshiftAudio();await a.start();await settle();return a;}
async function queue(a,target){a.setScene(target);await settle();a._tick();assert(a.transition);return a.transition;}

test('nine arrangements and eight precisely aligned stereo stems; flow adds distinct layers',async()=>{
 const a=await make();try{
  assert.equal(ClearshiftAudio.tracks.length,9);assert.equal(a.current.nodes.length,8);
  const starts=a.current.nodes.map(x=>x.source.started);assert(starts.every(x=>x.at===starts[0].at&&x.offset===starts[0].offset));
  assert(a.current.nodes.every(x=>x.source.loopEnd===256*beat));assert(a.current.nodes.every(x=>x.pan.pan.value===0));assert.equal(a.getTransport().bpm,122);
  for(let flow=1;flow<=8;flow++){a.setDrive({flow,activity:1});assert.equal(a.current.nodes.filter(x=>x.gain.gain.value>0).length,flow);}
 }finally{await a.dispose();}
});
test('cold scene waits for all assets, then starts at a future bar using its absolute offset',async()=>{
 const a=await make();try{
  let release;const gate=new Promise(r=>release=r);global.fetch=async url=>{if(url.includes('08-skywide'))await gate;return ok(url);};
  a.setScene(8);a.context.currentTime=4*beat;a._tick();assert.equal(a.transition,null);
  release();await settle();a._tick();const t=a.transition;assert.equal(t.boundary,8);
  assert(t.incoming.nodes.every(x=>x.source.started.offset===8*oldBeat));assert.equal(a.getTransport().scene,0);
  a.context.currentTime=t.at;await settle();assert.equal(a.getTransport().scene,8);assert.equal(a.getTransport().bpm,112);
 }finally{await a.dispose();}
});
test('pause and restart stop queued incoming sources and preserve the exact clock',async()=>{
 const a=await make();try{
  a.context.currentTime=2.5*beat;const t=await queue(a,2);const incoming=t.incoming.nodes.map(n=>n.source);
  await a.pause();assert.equal(a.getTransport().beats,2.5);assert.equal(a.diagnostics.activeVoices.activeSources,0);assert(incoming.every(x=>x.stopped&&x.disconnected));
  await a.restart(12.5);assert.equal(a.getTransport().beats,12.5);assert.equal(a.diagnostics.activeVoices.activeSources,8);
  for(let i=0;i<4;i++){await queue(a,(a.scene+1)%9);await a.restart(i);assert.equal(a.context.sources.filter(x=>!x.stopped).length,8);}
 }finally{await a.dispose();}
});
test('muting a queued transition mutes its incoming bus and does not restore the old level',async()=>{
 const a=await make();try{
  const t=await queue(a,2);a.setLevels(0,0);assert.equal(t.incoming.bus.gain.value,0);
  a.context.currentTime=t.at;await settle();assert.equal(a.current.bus.gain.value,0);
  a.react('flow',8);assert.equal(a.diagnostics.activeVoices.effects,0);
 }finally{await a.dispose();}
});
test('superseded transitions are stopped and the latest requested district wins',async()=>{
 const a=await make();try{
  const t=await queue(a,2);await queue(a,4);assert(t.incoming.nodes.every(n=>n.source.stopped));
  const final=a.transition;a.context.currentTime=final.at;await settle();assert.equal(a.scene,4);assert.equal(a.pendingScene,null);
 }finally{await a.dispose();}
});
test('late background loads cannot recreate a disposed context or repopulate its cache',async()=>{
 global.fetch=async url=>{if(url.includes('01-after-hours'))await new Promise(r=>setTimeout(r,70));return ok(url);};
 const a=new ClearshiftAudio();await a.start();const n=contexts.length;await a.dispose();await new Promise(r=>setTimeout(r,90));
 assert.equal(contexts.length,n);assert.equal(a.context,null);assert.equal(a.buffers.size,0);assert.equal(a.diagnostics.activeVoices.pendingLoads,0);
});
test('load failure is reported; a later successful start clears it',async()=>{
 const a=new ClearshiftAudio();global.fetch=async()=>{throw new Error('offline');};
 try{await assert.rejects(a.start(),/offline/);assert.equal(a.playing,false);assert.match(a.diagnostics.lastError,/offline/);global.fetch=ok;await a.start();assert.equal(a.diagnostics.lastError,null);}finally{await a.dispose();}
});
test('stalled requests time out and abort; the lifecycle can still close',async()=>{
 global.fetch=()=>new Promise(()=>{});const a=new ClearshiftAudio({loadTimeout:30});
 await assert.rejects(a.start(),/timed out/);await a.dispose();assert.equal(a.context,null);
});
test('all action sounds disconnect when finished or paused',async()=>{
 const a=await make();try{
  for(const type of ['select','place','pickup','shift','charge','sweep','end','flow'])assert(a.react(type,8));
  assert(a.diagnostics.activeVoices.effects>0);
  for(const source of a.context.sources)if(source.onended)source.onended();assert.equal(a.diagnostics.activeVoices.effects,0);
  a.react('flow',8);await a.pause();assert.equal(a.diagnostics.activeVoices.effects,0);assert(a.context.sources.every(x=>x.stopped&&x.disconnected));
 }finally{await a.dispose();}
});

test('tempo changes reanchor on the bar in both directions, including a delayed commit callback',async()=>{
 const a=await make();try{
  a.context.currentTime=2.5*beat;const t=await queue(a,1);
  a.context.currentTime=t.at-.001;const before=a.getTransport().beats;
  a.context.currentTime=t.at+.25;const after=a.getTransport();
  assert(after.beats>before);assert(Math.abs(after.beats-(t.boundary+.25/oldBeat))<1e-10);
  assert.equal(after.bpm,112);assert(a.current.nodes.some(x=>x.pan.pan.value>0));
  const back=await queue(a,0);a.context.currentTime=back.at+.5;
  assert(Math.abs(a.getTransport().beats-(back.boundary+.5/beat))<1e-10);assert.equal(a.getTransport().bpm,122);
 }finally{await a.dispose();}
});
test('the 64-bar song resumes in its second half and wraps at its own loop length',async()=>{
 const a=await make();try{
  await a.restart(200.5);assert(a.current.nodes.every(n=>Math.abs(n.source.started.offset-200.5*beat)<1e-10));
  await a.restart(260.5);assert(a.current.nodes.every(n=>Math.abs(n.source.started.offset-4.5*beat)<1e-10));
  assert.equal(a.getTransport().beats,260.5);
 }finally{await a.dispose();}
});
