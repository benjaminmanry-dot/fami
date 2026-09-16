(function(){
'use strict';
const levelOneLoop=new URLSearchParams(location.search).get('mode')==='level1';
const saveSuffix=levelOneLoop?'level1.v3':'v3';
const E=ClearshiftEngine,$=id=>document.getElementById(id),KEYS={run:'clearshift.run.'+saveSuffix,backup:'clearshift.backup.'+saveSuffix,prefs:'clearshift.preferences.'+saveSuffix};
const sceneForScore=score=>levelOneLoop?0:E.scene(score);
const SCENES=E.DISTRICTS.map(d=>d.name);
const defaults={music:.72,effects:.66,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,best:0,seen:false};
let prefs={...defaults},saveWarning='',saved=null;
try{const ownPrefs=localStorage.getItem(KEYS.prefs),p=JSON.parse(ownPrefs||(levelOneLoop?localStorage.getItem('clearshift.preferences.v3'):null)||'null');if(p){for(const k of ['music','effects'])if(Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)prefs[k]=p[k];for(const k of ['seen','reduced'])if(typeof p[k]==='boolean')prefs[k]=p[k];if((ownPrefs||!levelOneLoop)&&Number.isSafeInteger(p.best)&&p.best>=0)prefs.best=p.best;}
const raw=localStorage.getItem(KEYS.run);saved=E.restore(raw);if(raw&&!saved){saved=E.restore(localStorage.getItem(KEYS.backup));saveWarning=saved?'Recovered previous move':'Previous save could not be read';}}catch{saveWarning='Saving is unavailable';}
let state=saved||E.createGame(),started=false,running=false,busy=false,selected=null,anchor=null,preview=null,shiftMode=!!state.held;
let runStatus=E.status(state),tutorial=0,suspendedRun=null,modalKind='start',focusCell=0,touchInput=false,drag=null,suppressClick=false;
let clockBase=state.beats,clockAt=0,clockBpm=ClearshiftAudio.BPM,startEpoch=0,visibleScene=sceneForScore(state.score),requestedScene=visibleScene,lastDrive=0,activityEvents=[],particles=[],lastFrame=0,barRect=null;
const audio=new ClearshiftAudio(),cells=[],cards=[],animations=new Map();
audio.setLevels(prefs.music,prefs.effects);
const announce=text=>{$('announcer').textContent=text;};
function prefSave(){try{localStorage.setItem(KEYS.prefs,JSON.stringify(prefs));}catch{saveWarning='Saving is unavailable';}}
function save(){if(tutorial)return;try{const raw=E.serialize(state),old=localStorage.getItem(KEYS.run);if(old&&E.restore(old)&&old!==raw)localStorage.setItem(KEYS.backup,old);localStorage.setItem(KEYS.run,raw);saved=E.clone(state);prefs.best=Math.max(prefs.best,state.score);prefSave();}catch{saveWarning='Saving is unavailable';}$('save-status').textContent=saveWarning||'Saved on this device';}
function currentBeat(){
 if(!running)return state.beats;const t=audio.getTransport();if(t.playing)return t.beats;
 const now=performance.now(),beats=clockBase+(now-clockAt)*clockBpm/60000;
 if(t.bpm!==clockBpm){clockBase=beats;clockAt=now;clockBpm=t.bpm;}
 return beats;
}
function sound(type,count=1){try{audio.react(type,count);}catch{}}
function freeze(tail=0){if(running){const beat=currentBeat();running=false;advance(beat);}const epoch=++startEpoch;busy=false;drag=null;if(typeof tail==='number'&&tail>0)setTimeout(()=>{if(epoch===startEpoch&&!running)audio.pause().catch(()=>{});},tail);else audio.pause().catch(()=>{});save();}
async function playClock(){
 const epoch=++startEpoch;busy=true;clockBase=state.beats;render();
 try{await audio.pause();if(epoch!==startEpoch)return;audio.setScene(sceneForScore(state.score));await audio.restart(state.beats);}catch{announce('Audio is unavailable. The puzzle still plays.');}
 if(epoch!==startEpoch){audio.pause().catch(()=>{});return;}
 clockBase=state.beats;clockAt=performance.now();clockBpm=audio.getTransport().bpm;busy=false;running=true;requestedScene=sceneForScore(state.score);setScene(requestedScene,false);render();
}
function active(){return started&&running&&!busy&&!$('modal').open&&runStatus!=='over';}
function burst(text){if(prefs.reduced)return;const el=$('burst-label');el.textContent=text;el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');}
function animate(coords,kind){const until=performance.now()+(kind==='landed'?250:420);coords.forEach(([r,c])=>animations.set(r*8+c,{kind,until}));}
function emit(coords,color){
 if(prefs.reduced)return;const rect=$('board').getBoundingClientRect(),css=getComputedStyle(document.body);
 coords.forEach(([r,c])=>{for(let i=0;i<7;i++)particles.push({x:rect.left+(c+.5)*rect.width/8,y:rect.top+(r+.5)*rect.height/8,vx:(Math.random()-.3)*4,vy:(Math.random()-.6)*4,life:1,size:2+Math.random()*5,color:css.getPropertyValue('--tile'+(color||1)).trim()});});
}
function activity(amount){activityEvents.push({at:state.beats,amount});}
function setScene(index,celebrate=true){if(index===visibleScene&&document.body.dataset.scene===String(index))return;visibleScene=index;document.body.dataset.scene=index;document.querySelectorAll('.mural').forEach((el,i)=>el.classList.toggle('active',i===index));if(celebrate)burst(SCENES[index]);renderStats();}
function advance(beats){
 if(!Number.isFinite(beats))return;state.beats=Math.max(state.beats,beats);let changed=false;
 while(state.step<=Math.floor(state.beats/2)){
  const result=E.sweep(state);state=result.state;changed=true;
  if(result.cells.length){sound('sweep',result.cells.length);const coords=result.cells.map(p=>[p.r,p.c]);animate(coords,'collected');emit(coords,result.cells[0].color);activity(Math.min(1,result.cells.length*.17));}
  if(result.lap&&result.lap.flow>result.lap.previousFlow){burst(state.flow===8?'WILDSTYLE!':E.FLOW_NAMES[state.flow-1].toUpperCase());sound('flow',state.flow);announce('Flow '+state.flow+' of 8. '+E.FLOW_NAMES[state.flow-1]+'.');}
 }
 if(changed){
  if(tutorial===2&&!E.pending(state))tutorialShift();
  else if(tutorial===5&&!E.pending(state)){tutorial=6;showTutorialDone();return;}
  updateStatus();refreshPreview();render();save();
 }
 const desired=sceneForScore(state.score);if(desired!==requestedScene){requestedScene=desired;audio.setScene(desired);}
}
function updateStatus(){runStatus=E.status(state);if(runStatus==='over'&&started&&running&&!tutorial&&!$('modal').open){showEnd();}}
function renderStats(){
 $('score').textContent=state.score.toLocaleString();$('score-mobile').textContent=state.score.toLocaleString();$('line-count').textContent=state.lines;$('best-score').textContent=(tutorial?prefs.best:Math.max(prefs.best,state.score)).toLocaleString();
 $('chapter-label').textContent=tutorial?'PRACTICE / FIND THE RHYTHM':levelOneLoop?'LEVEL 1 / ON REPEAT':('0'+(visibleScene+1))+' / 09 DISTRICTS';$('scene-heading').textContent=SCENES[visibleScene];
 const earned=sceneForScore(state.score),next=E.DISTRICTS[earned+1],base=E.DISTRICTS[earned].score;
 $('chapter-progress').style.width=(levelOneLoop?100:next?Math.min(100,(state.score-base)/(next.score-base)*100):100)+'%';
 $('chapter-next').textContent=levelOneLoop?'Level 1 repeats · keep building flow':next?next.name+' at '+next.score.toLocaleString():'Skywide. The city is yours.';
 $('district-button').textContent=levelOneLoop?'Level 1 loop ↻':'Your route · '+(earned+1)+'/9';
 $('flow-value').textContent=state.flow+'/8';$('flow-name').textContent=E.FLOW_NAMES[state.flow-1];
 $('flow-multiplier').textContent='×'+E.multiplier(state.flow)+' sweep score';
 document.body.dataset.flow=state.flow;document.querySelectorAll('.flow-bars i').forEach((el,i)=>el.classList.toggle('on',i<state.flow));
 const floor=E.FLOW_THRESHOLDS[state.flow-1],ceiling=E.FLOW_THRESHOLDS[state.flow]||240;
 $('flow-progress').style.width=Math.min(100,Math.max(0,(state.flowEnergy-floor)/(ceiling-floor)*100))+'%';
 $('flow-copy').textContent=E.flowHint(state);
}
function refreshPreview(){if(!anchor){preview=null;return;}const [r,c]=anchor;preview=state.held?E.previewDrop(state,r,c):shiftMode?E.previewPickup(state,selected,r,c):E.previewPlacement(state,selected,r,c);}
function setAnchor(r,c){anchor=[r,c];refreshPreview();renderBoard();renderInput();}
function footprint(){if(selected===null||!state.tray[selected]||!anchor)return [];return E.SHAPES[state.tray[selected].id].cells.map(([r,c])=>[r+anchor[0],c+anchor[1]]);}
function renderBoard(){
 const inside=([r,c])=>r>=0&&r<8&&c>=0&&c<8;
 const actual=new Set((preview?.cells||[]).filter(inside).map(([r,c])=>r*8+c)),stencil=new Set((shiftMode?footprint():[]).filter(inside).map(([r,c])=>r*8+c)),payload=new Map();
 if(state.held&&anchor)state.held.pieces.forEach(p=>payload.set((anchor[0]+p.r)*8+anchor[1]+p.c,p.color));
 const source=new Set(state.held?state.held.pieces.map(p=>(state.held.row+p.r)*8+state.held.col+p.c):[]);
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){
  const i=r*8+c,el=cells[i],value=state.board[r][c],show=actual.has(i),colour=payload.get(i)||value||state.tray[selected]?.color||1;
  let classes='cell'+(value?' painted':'')+(state.charge[r][c]?' charged':'')+(source.has(i)?' source':'');
  if(show)classes+=preview.valid?(shiftMode&&!state.held?' pickup':' preview'):' blocked';
  if(stencil.has(i)&&!show)classes+=' stencil-gap';
  if((tutorial===1&&r===0&&c>=6)||(tutorial===3&&r===2&&c>=1&&c<=3)||(tutorial===4&&r===4&&c>=5))classes+=' target-help';
  const animation=animations.get(i);if(animation&&animation.until>performance.now())classes+=' '+animation.kind;
  el.className=classes;el.style.setProperty('--paint','var(--tile'+colour+')');el.tabIndex=i===focusCell?0:-1;
  el.setAttribute('aria-label','Row '+(r+1)+', column '+(c+1)+': '+(value?'paint '+value+(state.charge[r][c]?', charged for sweep':''):'empty')+(show?', '+(preview.valid?'valid preview':'blocked preview'):''));
 }
}
function renderTray(){
 for(let i=0;i<3;i++){
  const p=state.tray[i],card=cards[i];card.className='shape-card'+(p?'':' spent')+(selected===i?' selected':'');card.disabled=!p||!!state.held&&state.held.slot!==i||tutorial===2||tutorial===5;
  card.setAttribute('aria-pressed',String(selected===i));card.setAttribute('aria-label',p?'Shape '+(i+1)+': '+E.SHAPES[p.id].name+(shiftMode?', use as stencil':''):'Shape '+(i+1)+': used');
  if(!p){card.innerHTML='<span class="spent-mark" aria-hidden="true">✓</span>';continue;}
  const shape=E.SHAPES[p.id];card.innerHTML='<span class="number">'+(i+1)+'</span><span class="mini-shape" style="--w:'+shape.width+';--h:'+shape.height+';--paint:var(--tile'+p.color+')">'+shape.cells.map(([r,c])=>'<i class="mini-tile" style="grid-row:'+(r+1)+';grid-column:'+(c+1)+'"></i>').join('')+'</span><span class="piece-label">'+(shiftMode?'STENCIL · ':'')+shape.name+'</span>';
 }
}
function renderInput(message){
 let hint=message;
 if(!hint)hint=runStatus==='over'?'Session complete. A new mural awaits.':tutorial===2||tutorial===5?'The paint is charged. Watch the bar collect it.':state.held?'Move the lifted paint. Its empty gaps stay transparent.':shiftMode?(selected===null?'Choose a shape below to use as a stencil.':'Choose the paint to lift with this stencil.'):runStatus==='waiting'?'Make room: the next sweep is coming.':runStatus==='shift-only'?'A Shift can open a place for your next shape.':selected===null?'Choose a shape. Paint a full row or column.':'Place the shape before the bar comes around.';
 if(preview&&!preview.valid&&anchor)hint=preview.reason||'The paint needs empty squares.';
 $('board-hint').textContent=hint;$('cancel-button').hidden=selected===null&&!shiftMode;$('cancel-button').textContent=state.held?'Return paint':'Cancel';
 $('placement-actions').hidden=!(anchor&&selected!==null);$('commit-button').disabled=!preview?.valid||!active();$('commit-button').innerHTML=(state.held?'Put paint down':shiftMode?'Lift paint':'Place paint')+' <span>↵</span>';
 $('shift-panel').classList.toggle('ready',!!state.shift);$('shift-panel').classList.toggle('in-use',shiftMode);
 $('shift-state').textContent=state.held?'PAINT LIFTED':shiftMode?'CHOOSE PAINT':state.shift?'ONE READY':'UNCHARGED';
 $('shift-button').disabled=!state.shift||!started||runStatus==='over'||tutorial===1||tutorial===2||tutorial===5;
 $('shift-button').innerHTML=(shiftMode?'Cancel Shift':state.shift?'Use Shift':'Earn a Shift')+' <span>↗</span>';
 $('shift-copy').innerHTML=state.held?'Only the solid blocks travel.<br>Empty gaps leave other paint alone.':shiftMode?'Use a shape from your tray.<br>Lift paint, then choose its new home.':state.shift?'Your shape becomes a stencil.<br>Lift paint. Keep the offered piece.':'Complete a line to earn a Shift.<br>Use an offered shape to lift paint.';
 $('tray-count').textContent=state.tray.filter(Boolean).length+' / 3';$('tray-caption').textContent=shiftMode?'STENCIL ONLY. YOUR SHAPE STAYS IN THE TRAY.':'THREE SHAPES. YOUR NEXT PHRASE.';
}
function render(){
 renderStats();renderBoard();renderTray();renderInput();$('game').setAttribute('aria-busy',String(busy));document.body.classList.toggle('reduced',prefs.reduced);
 $('tutorial-banner').hidden=!tutorial;const copy={
  1:['01 / CHARGE A LINE','Select the pair. Fill the two outlined squares in the top row.'],
  2:['02 / HEAR THE SWEEP','Completed lines glow until the bar collects them. More productive passes build flow.'],
  3:['03 / LIFT WITH A STENCIL','Press Shift. Use shape 3 to lift the outlined paint in row 3. The middle square is empty.'],
  4:['04 / GAPS ARE TRANSPARENT','Put the lifted paint into the outline at row 5, column 6. The existing middle block stays exactly where it is.'],
  5:['05 / YOUR NEXT PHRASE','You kept the offered shape. The moved paint completed another line for the sweep.']
 };if(copy[tutorial]){$('tutorial-step').textContent=copy[tutorial][0];$('tutorial-copy').textContent=copy[tutorial][1];}
 $('save-status').textContent=tutorial?'Practice · your run is kept safe':saveWarning||'Saved on this device';
}
function choose(slot){
 if(!active()||!state.tray[slot]||state.held||tutorial===2||tutorial===5)return;
 if(tutorial===1&&slot!==0||tutorial===3&&slot!==2)return;
 selected=slot;anchor=null;preview=null;sound('select');render();
}
function toggleShift(){if(!active()||!state.shift||tutorial===1||tutorial===2||tutorial===5)return;if(shiftMode){cancel();return;}shiftMode=true;anchor=null;preview=null;sound('select');render();announce('Shift mode. Choose a stencil, then lift paint.');}
function cancel(){
 if(state.held){const result=E.cancelPickup(state);if(!result.ok)return;state=result.state;if(tutorial===4)tutorial=3;}
 shiftMode=false;selected=null;anchor=null;preview=null;drag=null;save();render();
}
function commit(){
 if(!active()||!anchor||!preview?.valid)return false;const [r,c]=anchor;
 if(tutorial===1&&(selected!==0||r!==0||c!==6)){renderInput('For practice, fill the top row at column 7.');return false;}
 if(tutorial===3&&(!shiftMode||selected!==2||r!==2||c!==1)){renderInput('Lift the outlined paint at row 3, column 2.');return false;}
 if(tutorial===4&&(r!==4||c!==5)){renderInput('Try row 5, column 6: the gap goes over existing paint.');return false;}
 const wasHeld=!!state.held,type=wasHeld?'shift':shiftMode?'pickup':'place';
 const result=wasHeld?E.drop(state,r,c):shiftMode?E.pickup(state,selected,r,c):E.place(state,selected,r,c);if(!result.ok)return false;
 state=result.state;sound(type,result.cells.length);animate(result.cells,'landed');
 if(type!=='pickup')activity(.4);if(result.lines?.count){sound('charge',result.lines.count);burst(result.lines.count>1?'DOUBLE TAG!':'CHARGED!');announce(result.lines.count+' line'+(result.lines.count>1?'s':'')+' charged for the sweep.');}
 if(type==='pickup'){if(tutorial===3)tutorial=4;announce('Lifted '+state.held.pieces.length+' blocks. Empty gaps are transparent.');}
 else{shiftMode=false;selected=null;if(tutorial===1)tutorial=2;else if(tutorial===4)tutorial=5;}
 anchor=null;preview=null;updateStatus();save();render();return true;
}
function modal(kind,html){freeze(kind==='end'?950:0);modalKind=kind;$('modal-content').innerHTML=html;if(!$('modal').open)$('modal').showModal();}
function buttons(content){return '<div class="modal-buttons">'+content+'</div>';}
function button(action,label,primary=true){return '<button data-action="'+action+'" class="'+(primary?'primary-button':'secondary-button')+'">'+label+'</button>';}
function modeButton(){return button(levelOneLoop?'journey':'level1',levelOneLoop?'Back to your journey':'Loop level 1 ↻',false);}
function switchMode(loop){freeze();const url=new URL(location.href);if(loop)url.searchParams.set('mode','level1');else url.searchParams.delete('mode');location.assign(url.href);}
function showStart(){
 if(levelOneLoop){modal('start','<div class="modal-eyebrow">CLEARSHIFT / LEVEL 1 LOOP</div><h2 class="modal-title" id="modal-title">FIND YOUR<br><span>FLOW.</span></h2><p class="modal-copy">Stay on Rooftop Radio. Cut It Loose plays on repeat while your sweeps build all eight flow layers. Keep scoring, keep shaping the mix.</p>'+buttons(button(saved?'resume':'new',saved?'Resume level 1 ↗':'Play level 1 ↗')+modeButton())+'<p class="modal-foot">Your journey and this loop save separately.<br>Flow rises and falls with your play. No automatic district changes.</p>');return;}
 modal('start','<div class="modal-eyebrow">CLEARSHIFT / STREET MIX</div><h2 class="modal-title" id="modal-title">PAINT THE<br><span>NEXT BEAT.</span></h2><p class="modal-copy">Chop a new path through the city. Build lines, lift paint, and let the sweep turn your play into music.</p>'+buttons(button(saved?'resume':'new',saved?'Resume session ↗':'Drop in ↗')+button('tutorial','Learn the rhythm',false)+modeButton())+'<p class="modal-foot">Nine districts. Eight flow tiers. A city that answers.<br>Loop level 1 to hear the first song develop without moving districts.</p>');
}
async function begin(resume=false){
 if(tutorial){tutorial=0;suspendedRun=null;}if(!resume)state=E.createGame();started=true;selected=state.held?.slot??null;shiftMode=!!state.held;anchor=null;preview=null;runStatus=E.status(state);activityEvents=[];
 $('modal').close();setScene(sceneForScore(state.score),false);render();save();if(runStatus==='over'){showEnd();return;}await playClock();
}
async function closeModal(){if(!started){showStart();return;}$('modal').close();if(runStatus==='over'){render();return;}await playClock();}
function showPause(){if(!started){showStart();return;}modal('pause','<div class="modal-eyebrow">'+(levelOneLoop?'LEVEL 1 / ON REPEAT':'NEED A BREATHER?')+'</div><h2 class="modal-small-title" id="modal-title">Holding your place.</h2><p class="modal-copy">The bar and the music are paused. Your paint will be here.</p>'+buttons(button('continue','Back to the groove ↗')+button(tutorial?'finish-tutorial':'new-confirm',tutorial?'Leave practice':'New run',false)+(tutorial?'':modeButton())));}
function showHelp(){modal('help','<div class="modal-eyebrow">HOW TO PLAY</div><h2 class="modal-small-title" id="modal-title">Make room. Make music.</h2><ol class="help-list"><li><b>Paint a full row or column.</b> Any colours work. Choose a shape, then click the board. On touch, tap to preview and use the place button. Dragging works too.</li><li><b>Let the bar collect it.</b> Completed lines glow until the bar reaches them. Plan ahead of the sweep to collect more paint in each pass.</li><li><b>Shift uses a shape as a stencil.</b> Completing a line earns one Shift. Choose an offered shape and lift existing paint. Only solid blocks move. Gaps can overlap other paint; carried blocks need empty landing squares.</li><li><b>Earn the upper mix.</b> Flow builds over several passes. 4–7 collected blocks can build to tier 4; 8–11 to tier 6; 12–15 to tier 7. Wildstyle, tier 8, needs a full meter and three consecutive passes of 16+ blocks. Light passes cool the mix.</li><li><b>'+(levelOneLoop?'Keep the record spinning.':'Cross the city.')+'</b> '+(levelOneLoop?'Level 1 stays on repeat at every score. The song and flow continue across each loop; your regular journey is saved separately.':'Score opens nine districts, each with a new musical arrangement, mural and block treatment. Check Your route for the next destination.')+' Flow tiers 1–2 / 3–4 / 5–6 / 7–8 score ×1 / ×2 / ×3 / ×4 on collected paint.</li></ol>'+buttons(button('close','Got it ↗')+button('tutorial','Try the practice board',false))+'<p class="modal-foot">1 / 2 / 3 choose a shape · Arrows move the preview · Enter commits · S toggles Shift · Escape cancels · Space pauses.<br>Shift keeps the offered shape. Shift-created lines do not earn another Shift. No timed game over.</p>');}
function showRoute(){
 if(levelOneLoop){modal('route','<div class="modal-eyebrow">LEVEL 1 / ON REPEAT</div><h2 class="modal-small-title" id="modal-title">One record. Eight layers.</h2><p class="route-copy">Rooftop Radio stays with you at every score. Cut It Loose loops through its full arrangement while you build the mix through stronger sweeps.</p><ol class="flow-guide">'+E.FLOW_NAMES.map((name,i)=>'<li><b>'+String(i+1).padStart(2,'0')+'</b> '+name+'</li>').join('')+'</ol><p class="modal-foot">Flow follows the usual rules. Wildstyle needs sustained momentum and three consecutive passes collecting 16+ blocks. A quiet pass cools the mix; a song loop does not reset it.</p>'+buttons(button('close','Back to the groove ↗')+modeButton()));return;}
 const earned=sceneForScore(state.score);
 modal('route','<div class="modal-eyebrow">YOUR ROUTE / STREET MIX</div><h2 class="modal-small-title" id="modal-title">Take the long way up.</h2><p class="route-copy">Every district changes the record, the mural, and the paint in your hands. Keep scoring to reach the next one.</p><ol class="district-list">'+E.DISTRICTS.map((d,i)=>'<li class="'+(i===earned?'current':i<earned?'visited':'locked')+'"><span class="route-number">'+String(i+1).padStart(2,'0')+'</span><b>'+d.name+'</b><small>'+(i===earned?'Playing here':i<earned?'Reached this run':d.score.toLocaleString()+' points')+'</small><span class="route-material">'+d.material+'</span></li>').join('')+'</ol><p class="route-copy">Eight musical tiers, earned through stronger sweeps:</p><ol class="flow-guide">'+E.FLOW_NAMES.map((name,i)=>'<li><b>'+String(i+1).padStart(2,'0')+'</b> '+name+'</li>').join('')+'</ol><p class="modal-foot">Wildstyle needs sustained momentum and three consecutive passes of 16+ collected blocks. Pausing holds everything exactly where you left it.</p>'+buttons(button('close','Back to the groove ↗')));
}
function showSettings(){modal('settings','<div class="modal-eyebrow">THE MIX</div><h2 class="modal-small-title" id="modal-title">Make it feel right.</h2><div class="setting"><label for="music-level">Music <output id="music-output">'+Math.round(prefs.music*100)+'%</output></label><input id="music-level" type="range" min="0" max="100" value="'+Math.round(prefs.music*100)+'"></div><div class="setting"><label for="effects-level">Paint &amp; sweep sounds <output id="effects-output">'+Math.round(prefs.effects*100)+'%</output></label><input id="effects-level" type="range" min="0" max="100" value="'+Math.round(prefs.effects*100)+'"></div><label class="check-label"><input id="reduced-motion" type="checkbox" '+(prefs.reduced?'checked':'')+'> Reduced motion &amp; softer flashes</label><p class="modal-foot">The moving bar stays visible so the timing remains clear.</p><div style="margin-top:24px">'+buttons(button('close','Back to the groove ↗'))+'</div>');}
function showRestart(){modal('restart','<div class="modal-eyebrow">FRESH PAINT</div><h2 class="modal-small-title" id="modal-title">Start a new session?</h2><p class="modal-copy">This replaces the current run. Your best score stays.</p>'+buttons(button('new','Start fresh ↗')+button('close','Keep this run',false)));}
function showEnd(){sound('end');modal('end','<div class="modal-eyebrow">SESSION COMPLETE</div><h2 class="modal-small-title" id="modal-title">Leave your mark.</h2><div class="end-stats"><div><strong>'+state.score.toLocaleString()+'</strong><span>POINTS</span></div><div><strong>'+(levelOneLoop?'↻':(sceneForScore(state.score)+1)+'/9')+'</strong><span>'+(levelOneLoop?'LEVEL 1 LOOP':'DISTRICTS')+'</span></div><div><strong>'+state.bestFlow+'/8</strong><span>BEST FLOW</span></div></div><p class="modal-copy">The offered shapes have no space, and no available Shift can open one.</p>'+buttons(button('new',levelOneLoop?'Play level 1 again ↻':'Another session ↗')+button('inspect','Look at the board',false)+modeButton()));save();}
async function startTutorial(){
 freeze();if(!tutorial)suspendedRun={state:E.clone(state),started};tutorial=1;state=E.createGame(112);for(let c=0;c<6;c++)state.board[0][c]=1+c%3;state.tray=[{id:'two-h',color:2},{id:'square',color:1},{id:'three-h',color:3}];
 started=true;selected=0;shiftMode=false;anchor=null;preview=null;runStatus='play';$('modal').close();setScene(0,false);render();await playClock();
}
function tutorialShift(){
 const beats=state.beats,step=state.step;state=E.createGame(112);state.beats=beats;state.step=step;state.shift=1;state.tray=[null,{id:'square',color:1},{id:'three-h',color:3}];
 state.board[2][1]=2;state.board[2][3]=3;for(let c=0;c<8;c++)if(c!==5&&c!==7)state.board[4][c]=1+c%3;
 tutorial=3;selected=2;anchor=null;preview=null;shiftMode=false;runStatus='play';burst('LIFT THE PAINT');
}
function showTutorialDone(){modal('tutorialdone','<div class="modal-eyebrow">THAT’S THE RHYTHM</div><h2 class="modal-small-title" id="modal-title">A gap is still a gap.</h2><p class="modal-copy">You moved two blocks with a three-square stencil. The middle block at the destination stayed put. Then the sweep turned your new line into music.</p>'+buttons(button('finish-tutorial',suspendedRun?.started?'Return to your session ↗':'Start your session ↗'))+'<p class="modal-foot">Keep feeding the sweep to build flow. A quieter pass eases the mix back without ending your run.</p>');}
async function finishTutorial(){const previous=suspendedRun;tutorial=0;suspendedRun=null;prefs.seen=true;prefSave();state=previous?.state||E.createGame();started=true;selected=state.held?.slot??null;shiftMode=!!state.held;anchor=null;preview=null;runStatus=E.status(state);$('modal').close();render();save();if(runStatus==='over')showEnd();else await playClock();}
const rows=Array.from({length:8},(_,r)=>{const row=document.createElement('div');row.className='board-row';row.setAttribute('role','row');row.setAttribute('aria-label','Row '+(r+1));$('board').appendChild(row);return row;});
for(let r=0;r<8;r++)for(let c=0;c<8;c++){
 const el=document.createElement('button');el.type='button';el.setAttribute('role','gridcell');el.dataset.row=r;el.dataset.col=c;
 el.addEventListener('pointerenter',e=>{if(active()&&e.pointerType!=='touch'&&selected!==null&&!drag)setAnchor(r,c);});
 el.addEventListener('pointerdown',e=>{touchInput=e.pointerType==='touch';if(active()&&state.held)drag={kind:'held',id:e.pointerId,x:e.clientX,y:e.clientY,active:false};});
 el.addEventListener('click',e=>{if(suppressClick){suppressClick=false;return;}if(!active())return;focusCell=r*8+c;if(selected===null){renderInput('Choose a shape below the board first.');return;}const same=anchor?.[0]===r&&anchor?.[1]===c;setAnchor(r,c);if(!touchInput&&(e.detail>0||same))commit();});
 rows[r].appendChild(el);cells.push(el);
}
for(let slot=0;slot<3;slot++){
 const card=document.createElement('button');card.type='button';card.dataset.slot=slot;
 card.addEventListener('click',()=>{if(suppressClick){suppressClick=false;return;}choose(slot);});
 card.addEventListener('pointerdown',e=>{if(!active()||!state.tray[slot]||state.held)return;touchInput=e.pointerType==='touch';drag={kind:'tray',slot,id:e.pointerId,x:e.clientX,y:e.clientY,active:false};card.setPointerCapture(e.pointerId);});
 $('tray').appendChild(card);cards.push(card);
}
function pointerAnchor(e){const rect=$('board').getBoundingClientRect();setAnchor(Math.floor((e.clientY-rect.top)/rect.height*8),Math.floor((e.clientX-rect.left)/rect.width*8));}
document.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;if(!drag.active&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){if(drag.kind==='tray')choose(drag.slot);drag.active=true;}if(drag.active){e.preventDefault();pointerAnchor(e);}},{passive:false});
document.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const moved=drag.active;drag=null;if(moved){suppressClick=true;setTimeout(()=>suppressClick=false,100);pointerAnchor(e);if(!commit()){anchor=null;preview=null;render();}}});
document.addEventListener('pointercancel',()=>{drag=null;anchor=null;preview=null;render();});
$('board').addEventListener('pointerleave',()=>{if(!touchInput&&!drag){anchor=null;preview=null;renderBoard();renderInput();}});
$('board').addEventListener('keydown',e=>{
 if(!active())return;const delta={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]}[e.key];if(!delta)return;
 e.preventDefault();const r=Math.max(0,Math.min(7,Math.floor(focusCell/8)+delta[0])),c=Math.max(0,Math.min(7,focusCell%8+delta[1]));focusCell=r*8+c;cells[focusCell].focus();if(selected!==null)setAnchor(r,c);
});
document.addEventListener('keydown',e=>{
 if($('modal').open||/INPUT|TEXTAREA/.test(e.target.tagName))return;
 if(e.key==='Escape'){cancel();e.preventDefault();}
 else if(['1','2','3'].includes(e.key)){touchInput=false;choose(+e.key-1);if(selected!==null){cells[focusCell].focus();setAnchor(Math.floor(focusCell/8),focusCell%8);}e.preventDefault();}
 else if(e.key.toLowerCase()==='s'){toggleShift();e.preventDefault();}
 else if(e.key==='Enter'&&e.target.getAttribute('role')==='gridcell'){e.preventDefault();commit();}
 else if(e.code==='Space'){e.preventDefault();showPause();}
});
$('shift-button').onclick=toggleShift;$('cancel-button').onclick=cancel;$('commit-button').onclick=commit;$('pause-button').onclick=showPause;$('home-button').onclick=showPause;$('help-button').onclick=showHelp;$('sound-button').onclick=showSettings;$('restart-button').onclick=showRestart;$('district-button').onclick=showRoute;
$('modal-content').addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;const actions={level1:()=>switchMode(true),journey:()=>switchMode(false),new:()=>begin(false),resume:()=>begin(true),tutorial:startTutorial,'finish-tutorial':finishTutorial,continue:closeModal,close:closeModal,'new-confirm':showRestart,inspect:()=>{$('modal').close();render();}};actions[action]?.();});
$('modal-content').addEventListener('input',e=>{if(e.target.id==='music-level'){prefs.music=+e.target.value/100;$('music-output').textContent=e.target.value+'%';}if(e.target.id==='effects-level'){prefs.effects=+e.target.value/100;$('effects-output').textContent=e.target.value+'%';}if(e.target.id==='reduced-motion')prefs.reduced=e.target.checked;audio.setLevels(prefs.music,prefs.effects);prefSave();document.body.classList.toggle('reduced',prefs.reduced);});
$('modal').addEventListener('cancel',e=>{e.preventDefault();if(['start','end','tutorialdone'].includes(modalKind))return;closeModal();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started){if(!$('modal').open)showPause();else freeze();}});
window.addEventListener('pagehide',freeze);window.addEventListener('blur',()=>{drag=null;if(started&&running&&!$('modal').open)showPause();});
const canvas=$('paint-fx'),ctx=canvas.getContext('2d');let w=0,h=0,dpr=1;
function resize(){w=innerWidth;h=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);barRect=null;drag=null;}
window.addEventListener('resize',resize);resize();
function draw(time){
 const dt=Math.min(40,time-lastFrame||16);lastFrame=time;if(running&&!document.hidden){advance(currentBeat());const t=audio.getTransport();setScene(t.playing?t.scene:requestedScene);if(time-lastDrive>150){activityEvents=activityEvents.filter(e=>state.beats-e.at<24);const drive=Math.min(1,activityEvents.reduce((sum,e)=>sum+e.amount*Math.exp(-(state.beats-e.at)/10),0));audio.setDrive({activity:drive,flow:state.flow});lastDrive=time;}}
 const beat=state.beats,phase=beat%1;document.documentElement.style.setProperty('--beat',running&&!prefs.reduced?Math.exp(-phase*7).toFixed(3):'0');document.body.classList.toggle('playing',running);
 const rect=$('board').getBoundingClientRect(),frame=$('board-frame').getBoundingClientRect(),fraction=(beat/2)%8;
 // The bright edge touches a column's leading edge at the same beat that collects it.
 $('sweep-bar').style.left=(rect.left-frame.left+fraction*rect.width/8)+'px';
 $('track-title').textContent=ClearshiftAudio.tracks[visibleScene]?.name||SCENES[visibleScene];$('track-copy').textContent=audio.diagnostics.lastError?'Audio unavailable · sweep still plays':busy?'Loading the next record…':!started?'Sound starts when you play':!running?'Paused · holding your place':E.FLOW_NAMES[state.flow-1]+' · '+audio.getTransport().bpm+' BPM';
 ctx.clearRect(0,0,w,h);if(!prefs.reduced){particles=particles.filter(p=>p.life>0);for(const p of particles){p.x+=p.vx*dt/16;p.y+=p.vy*dt/16;p.vy+=.025*dt/16;p.life-=dt*.0015;ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size*.6);}ctx.globalAlpha=1;}else particles=[];
 let expired=false;for(const [i,a] of animations)if(a.until<time){animations.delete(i);expired=true;}if(expired)renderBoard();
 requestAnimationFrame(draw);
}
setScene(visibleScene,false);render();showStart();requestAnimationFrame(draw);
globalThis.Clearshift={version:'3.1.1',snapshot:()=>({mode:levelOneLoop?'level1-loop':'journey',state:E.clone(state),started,running,busy,selected,anchor:anchor?.slice()||null,shiftMode,tutorial,status:runStatus,modal:$('modal').open?modalKind:null,scene:visibleScene,preview:preview?{valid:preview.valid,cells:preview.cells,reason:preview.reason}:null,prefs:{...prefs},audio:audio.diagnostics,transport:audio.getTransport()})};
})();
