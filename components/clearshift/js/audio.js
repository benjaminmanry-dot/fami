/* Clearshift: original sampled arrangements. Editable production and source
 * permissions are in music-production/. The sweep and stems share one clock. */
(function (global) {
  'use strict';
  const STEMS=['01-base','02-keys','03-guitar','04-mallet','05-chops','06-horns','07-counter','08-lead'];
  const CUT_STEMS=['01-core','02-breaks','03-guitar','04-cuts','05-percussion','06-bass-drive','07-turntable','08-finale'];
  const PANS=[-.04,-.16,.21,.16,-.08,.22,-.18,.12];
  const TRACKS=[
    ['Cut It Loose','cut-it-loose','Live breaks / guitar cuts / turntable voices',[33,33,33,33]],
    ['After Hours','after-hours','Late-night bass / smoky chord cuts',[29,36,34,31]],
    ['Wild Current','wild-current','Loose funk / bright guitar answers',[33,40,38,36]],
    ['Sunrail Market','sunrail-market','Daylight bounce / open chords',[28,37,33,35]],
    ['Cobalt Arcade','cobalt-arcade','Staccato breaks / electric pocket',[24,31,29,36]],
    ['Canopy Line','canopy-line','Open-air shuffle / mallet echoes',[31,38,33,36]],
    ['Chrome Harbor','chrome-harbor','Industrial pocket / metallic cuts',[35,30,33,28]],
    ['Solar Steps','solar-steps','Sunlit breaks / climbing phrases',[24,29,33,31]],
    ['Skywide','skywide','Skyward finale / horn responses',[28,35,33,38]]
  ].map((v,index)=>({index,name:v[0],slug:v[1],description:v[2],roots:v[3],bpm:index===0?122:112,loopBeats:index===0?256:128,stems:index===0?CUT_STEMS:STEMS,pans:index===0?Array(8).fill(0):PANS}));
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));
  const mod=(n,d)=>((n%d)+d)%d;
  const aborted=()=>Object.assign(new Error('Audio request superseded'),{name:'AbortError'});
  function ramp(param,value,at,duration=.08){
    param.cancelScheduledValues(at);param.setValueAtTime(param.value,at);
    param.linearRampToValueAtTime(value,at+duration);
  }

  class ClearshiftAudio {
    constructor(options={}) {
      this.onBeat=typeof options.onBeat==='function'?options.onBeat:null;
      this.assetBase=(options.assetBase||'assets/music/').replace(/\/?$/,'/');
      this.loadTimeout=options.loadTimeout||10000;
      this.levels={music:.78,effects:.72};this.drive={activity:.25,flow:1};
      this.context=null;this.playing=false;this.positionBeats=0;this.startedAt=0;
      this.scene=0;this.pendingScene=null;this.readyScene=null;this.transition=null;
      this.current=null;this.buffers=new Map();this._loads=new Map();
      this._sets=new Set();this._effects=new Set();this._generation=0;this._sceneLoadToken=0;
      this.timer=null;this._commitTimer=null;this.lastNotified=-1;this.lastError=null;
      this._lifecycle=Promise.resolve();
    }
    _enqueue(work){const p=this._lifecycle.catch(()=>{}).then(work);this._lifecycle=p;return p;}
    _ctx(){
      if(this.context&&this.context.state!=='closed')return this.context;
      const Context=global.AudioContext||global.webkitAudioContext;
      if(!Context)throw new Error('This browser has no Web Audio support.');
      this.context=new Context({latencyHint:'interactive'});return this.context;
    }
    _url(scene,stem){return this.assetBase+String(scene).padStart(2,'0')+'-'+TRACKS[scene].slug+'/'+stem+'.wav';}
    _beatSeconds(scene=this.scene){return 60/TRACKS[scene].bpm;}
    _loopSeconds(scene=this.scene){return TRACKS[scene].loopBeats*this._beatSeconds(scene);}
    _toneFrequency(scene){return scene===0?11000+this.drive.activity*5000:3500+this.drive.activity*13000;}
    _abortLoads(){for(const entry of this._loads.values())entry.controller.abort();this._loads.clear();}
    _decode(scene,stem){
      const key=scene+':'+stem;
      if(this.buffers.has(key))return Promise.resolve(this.buffers.get(key));
      if(this._loads.has(key))return this._loads.get(key).promise;
      const ctx=this.context,generation=this._generation,controller=new AbortController();
      const entry={controller,promise:null};let timeout;
      const work=(async()=>{
        const response=await global.fetch(this._url(scene,stem),{signal:controller.signal});
        if(!response.ok)throw new Error('Could not load '+this._url(scene,stem));
        const bytes=await response.arrayBuffer();
        if(generation!==this._generation||ctx!==this.context||ctx.state==='closed')throw aborted();
        const buffer=await ctx.decodeAudioData(bytes);
        if(generation!==this._generation||ctx!==this.context||ctx.state==='closed'||controller.signal.aborted)throw aborted();
        if(Math.abs(buffer.duration-this._loopSeconds(scene))>.001)throw new Error('Music stem has an invalid loop length');
        this.buffers.set(key,buffer);return buffer;
      })();
      const deadline=new Promise((_,reject)=>{timeout=global.setTimeout(()=>{
        controller.abort();reject(new Error('Music loading timed out'));
      },this.loadTimeout);});
      entry.promise=Promise.race([work,deadline]).finally(()=>{
        global.clearTimeout(timeout);if(this._loads.get(key)===entry)this._loads.delete(key);
      });
      this._loads.set(key,entry);return entry.promise;
    }
    async _loadScene(scene){
      const results=await Promise.allSettled(TRACKS[scene].stems.map(stem=>this._decode(scene,stem)));
      const bad=results.find(r=>r.status==='rejected');if(bad)throw bad.reason;
      return results.map(r=>r.value);
    }
    _prune(){
      const keep=new Set([this.scene,(this.scene+1)%TRACKS.length,this.pendingScene,this.transition?.scene].filter(Number.isInteger));
      for(const key of this.buffers.keys())if(!keep.has(Number(key.split(':')[0])))this.buffers.delete(key);
    }
    _preload(){
      const generation=this._generation;
      this._loadScene((this.scene+1)%TRACKS.length).then(()=>{
        if(generation===this._generation)this._prune();
      }).catch(()=>{});
    }
    _position(){
      if(this.playing&&this.transition&&this.context.currentTime>=this.transition.at)this._commitScene(this.transition);
      return this.playing?this.positionBeats+(this.context.currentTime-this.startedAt)/this._beatSeconds():this.positionBeats;
    }
    _layerGain(index,scene=this.scene){return index>=this.drive.flow?0:scene===0?.9+this.drive.activity*.1:(index===0?.72+this.drive.activity*.16:.52+this.drive.activity*.30);}
    _startStemSet(scene,at,beatOffset,fade=.06){
      const ctx=this.context,bus=ctx.createGain(),tone=ctx.createBiquadFilter(),master=ctx.createDynamicsCompressor();
      tone.type='lowpass';tone.Q.value=.45;tone.frequency.value=this._toneFrequency(scene);
      master.threshold.value=scene===0?-2:-14;master.knee.value=scene===0?2:12;master.ratio.value=scene===0?12:4;master.attack.value=.005;master.release.value=.13;
      bus.gain.setValueAtTime(0,at);bus.gain.linearRampToValueAtTime(this.levels.music,at+fade);
      bus.connect(tone).connect(master).connect(ctx.destination);
      const set={scene,bus,tone,master,nodes:[],retiring:false,stopTimer:null};this._sets.add(set);
      try{
        TRACKS[scene].stems.forEach((stem,index)=>{
          const source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner();
          source.buffer=this.buffers.get(scene+':'+stem);if(!source.buffer)throw new Error('Music stem is not ready');
          source.loop=true;source.loopStart=0;source.loopEnd=this._loopSeconds(scene);
          gain.gain.value=this._layerGain(index,scene);pan.pan.value=TRACKS[scene].pans[index];
          source.connect(gain).connect(pan).connect(bus);set.nodes.push({source,gain,pan});
          source.start(at,mod(beatOffset,TRACKS[scene].loopBeats)*this._beatSeconds(scene));
        });return set;
      }catch(error){this._stopSet(set);throw error;}
    }
    _stopSet(set){
      if(!set||!this._sets.has(set))return;
      global.clearTimeout(set.stopTimer);
      for(const {source,gain,pan} of set.nodes){try{source.stop();}catch(_){}source.disconnect();gain.disconnect();pan.disconnect();}
      set.bus.disconnect();set.tone.disconnect();set.master.disconnect();this._sets.delete(set);
    }
    _cancelTransition(){
      global.clearTimeout(this._commitTimer);this._commitTimer=null;
      if(this.transition)this._stopSet(this.transition.incoming);
      this.transition=null;
      if(this.current&&this.context)ramp(this.current.bus.gain,this.levels.music,this.context.currentTime,.04);
    }
    _applyDrive(){
      if(!this.context)return;const at=this.context.currentTime;
      for(const set of this._sets)if(!set.retiring){
        ramp(set.tone.frequency,this._toneFrequency(set.scene),at,.22);
        set.nodes.forEach(({gain},i)=>ramp(gain.gain,this._layerGain(i,set.scene),at,.10));
      }
    }
    _tick(){
      if(!this.playing)return;const pos=this._position();
      if(this.pendingScene!=null&&this.readyScene===this.pendingScene&&!this.transition){
        const boundary=Math.ceil((pos+.12)/4)*4,at=this.context.currentTime+(boundary-pos)*this._beatSeconds();
        const t={scene:this.pendingScene,boundary,at,generation:this._generation};
        t.incoming=this._startStemSet(t.scene,at,boundary,.10);this.transition=t;
        this.current.bus.gain.setValueAtTime(this.levels.music,at);this.current.bus.gain.linearRampToValueAtTime(0,at+.10);
        this.pendingScene=null;this.readyScene=null;this._commitScene(t);
      }
      const whole=Math.floor(pos+.0001);if(whole>this.lastNotified){this.lastNotified=whole;if(this.onBeat)this.onBeat(this.getTransport());}
    }
    _commitScene(t){
      if(this.transition!==t||!this.playing||t.generation!==this._generation)return;
      if(this.context.currentTime+.0005<t.at){this._commitTimer=global.setTimeout(()=>this._commitScene(t),8);return;}
      global.clearTimeout(this._commitTimer);this._commitTimer=null;const outgoing=this.current;outgoing.retiring=true;
      outgoing.stopTimer=global.setTimeout(()=>this._stopSet(outgoing),120);
      // Preserve the musical position at the transition before changing tempo.
      this.current=t.incoming;this.positionBeats=t.boundary;this.startedAt=t.at;
      this.scene=t.scene;this.transition=null;this.lastError=null;
      this._prune();this._preload();
    }
    async _start(){
      if(this.playing)return this;
      ++this._generation;this._abortLoads();const generation=this._generation;
      try{
        const ctx=this._ctx();if(ctx.state!=='running')await ctx.resume();
        await this._loadScene(this.scene);if(generation!==this._generation)return this;
        this.startedAt=ctx.currentTime;this.current=this._startStemSet(this.scene,this.startedAt,this.positionBeats);
        this.playing=true;this.lastError=null;this.lastNotified=Math.floor(this.positionBeats)-1;
        this.timer=global.setInterval(()=>this._tick(),40);this._tick();this._prune();this._preload();return this;
      }catch(error){
        this.lastError=error;this._abortLoads();for(const set of this._sets)this._stopSet(set);this.current=null;
        if(this.context?.state==='running')await this.context.suspend();throw error;
      }
    }
    start(){return this._enqueue(()=>this._start());}
    resume(){return this.start();}
    async _pause(){
      if(this.playing)this.positionBeats=this._position();this.playing=false;
      ++this._generation;++this._sceneLoadToken;this._abortLoads();
      global.clearInterval(this.timer);this.timer=null;global.clearTimeout(this._commitTimer);this._commitTimer=null;
      const target=this.pendingScene??this.transition?.scene;
      for(const set of this._sets)this._stopSet(set);
      for(const effect of this._effects)effect.stop();
      this.current=null;this.transition=null;this.pendingScene=null;this.readyScene=null;
      if(Number.isInteger(target))this.scene=target;
      this._prune();if(this.context&&this.context.state!=='closed')await this.context.suspend();return this;
    }
    pause(){return this._enqueue(()=>this._pause());}
    restart(positionBeats=0){return this._enqueue(async()=>{await this._pause();this.positionBeats=clamp(positionBeats,0,1e12);return this._start();});}
    setLevels(music,effects){
      this.levels={music:clamp(music,0,1),effects:clamp(effects,0,1)};
      if(!this.context)return;const at=this.context.currentTime;
      if(this.current)ramp(this.current.bus.gain,this.levels.music,at,.06);
      if(this.transition){
        const t=this.transition;
        t.incoming.bus.gain.cancelScheduledValues(at);t.incoming.bus.gain.setValueAtTime(0,t.at);t.incoming.bus.gain.linearRampToValueAtTime(this.levels.music,t.at+.10);
        this.current.bus.gain.setValueAtTime(this.levels.music,t.at);this.current.bus.gain.linearRampToValueAtTime(0,t.at+.10);
      }
      if(this.levels.effects===0)for(const effect of this._effects)effect.stop();
    }
    setScene(index){
      const target=Math.round(clamp(index,0,TRACKS.length-1));
      if(target===this.pendingScene||target===this.transition?.scene)return target;
      const token=++this._sceneLoadToken;this._cancelTransition();this.pendingScene=null;this.readyScene=null;
      if(!this.playing){this.scene=target;this._prune();return target;}
      if(target===this.scene)return target;
      this.pendingScene=target;const generation=this._generation;
      this._loadScene(target).then(()=>{
        if(this.playing&&generation===this._generation&&token===this._sceneLoadToken){this.readyScene=target;this.lastError=null;this._prune();}
      }).catch(error=>{if(generation===this._generation&&token===this._sceneLoadToken)this.lastError=error;});return target;
    }
    setDrive(values={}){
      this.drive={activity:values.activity==null?this.drive.activity:clamp(values.activity,0,1),flow:values.flow==null?this.drive.flow:Math.round(clamp(values.flow,1,8))};this._applyDrive();
    }
    react(type,count=1){
      if(!this.context||!this.playing||!['select','place','pickup','shift','charge','sweep','end','flow'].includes(type))return false;
      if(this.levels.effects===0)return true;
      const ctx=this.context,n=Math.round(clamp(count,1,64)),pos=this._position();
      const at=ctx.currentTime+(type==='flow'?Math.max(.01,(Math.ceil(pos-.001)-pos)*this._beatSeconds()):.006);
      const root=TRACKS[this.scene].roots[Math.floor(pos/4)%4]+24;
      const intervals={select:[12],place:[0,7],pickup:[12,7],shift:[7,12],charge:[0,7,12],sweep:[12,19,24],end:[12,7,0],flow:n===8?[0,7,12,19,24]:[7,12,19]}[type];
      const step=type==='flow'?this._beatSeconds()/4:type==='end'?.10:.022;
      intervals.forEach((interval,i)=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain(),pan=ctx.createStereoPanner();
        const t=at+i*step,duration=type==='flow'?.25:type==='select'?.05:.16;
        osc.type=type==='select'?'sine':'triangle';osc.frequency.value=440*2**((root+interval-69)/12);pan.pan.value=(i-(intervals.length-1)/2)*.16;
        gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime((type==='sweep'?.033:.025)*this.levels.effects,t+.006);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
        osc.connect(gain).connect(pan).connect(ctx.destination);
        const effect={stop:()=>{try{osc.stop();}catch(_){}osc.disconnect();gain.disconnect();pan.disconnect();this._effects.delete(effect);}};
        this._effects.add(effect);osc.onended=effect.stop;osc.start(t);osc.stop(t+duration+.01);
      });return true;
    }
    getTransport(){const beats=this._position(),beat=Math.floor(beats);return {beat,phase:beats-beat,beats,bar:Math.floor(beat/4),bpm:TRACKS[this.scene].bpm,playing:this.playing,scene:this.scene,track:TRACKS[this.scene].name};}
    get diagnostics(){return {contextState:this.context?.state||'uninitialized',lastError:this.lastError?String(this.lastError.message||this.lastError):null,activeVoices:{activeSources:[...this._sets].reduce((n,s)=>n+s.nodes.length,0),effects:this._effects.size,loadedBuffers:this.buffers.size,pendingLoads:this._loads.size},pendingScene:this.pendingScene??this.transition?.scene??null};}
    dispose(){return this._enqueue(async()=>{await this._pause();this.buffers.clear();if(this.context&&this.context.state!=='closed')await this.context.close();this.context=null;return this;});}
    static async renderProof(seconds=72,options={}){
      const Offline=global.OfflineAudioContext||global.webkitOfflineAudioContext;
      if(!Offline)throw new Error('Offline audio rendering is unavailable.');
      const duration=clamp(seconds,2,180),ctx=new Offline(2,Math.ceil(duration*32000),32000);
      const player=new ClearshiftAudio(options);player.context=ctx;player.levels={music:.9,effects:0};
      player.scene=Math.round(clamp(options.scene||0,0,8));await player._loadScene(player.scene);
      player.drive={flow:1,activity:.65};const set=player._startStemSet(player.scene,0,0,.02);
      // A labelled progression demonstration, not a recording of earned play.
      for(let tier=2;tier<=8;tier++){
        const at=(tier-1)*duration/8;player.drive.flow=tier;
        set.nodes.forEach(({gain},i)=>{gain.gain.setValueAtTime(i<tier-1?player._layerGain(i):0,at);gain.gain.linearRampToValueAtTime(player._layerGain(i),at+.12);});
      }
      set.bus.gain.setValueAtTime(.9,duration-.35);set.bus.gain.linearRampToValueAtTime(0,duration);
      const rendered=await ctx.startRendering();player._stopSet(set);return rendered;
    }
  }
  ClearshiftAudio.BPM=TRACKS[0].bpm;ClearshiftAudio.tracks=TRACKS;global.ClearshiftAudio=ClearshiftAudio;
}(globalThis));
