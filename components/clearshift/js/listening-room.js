(function(){
 'use strict';
 const $=id=>document.getElementById(id),record=$('record'),previous=$('previous');
 const audio=new ClearshiftAudio(),names=['The core groove','Break crunch + ghost notes','Guitar replies + double','Vocal cuts + answers','Moving hats + cymbals','Bass fills + octave answers','Turntable throws + reverses','Octave guitar + crowd reply'];
 let active=false,loading=false,flow=8,epoch=0;
 audio.setLevels(.9,0);audio.setDrive({flow,activity:1});
 function choose(value){flow=value;audio.setDrive({flow,activity:1});Array.from($('layers').children).forEach((b,i)=>b.setAttribute('aria-pressed',String(i+1===flow)));$('layer-copy').textContent=flow+' / 8 · '+names[flow-1];}
 names.forEach((name,i)=>{const b=document.createElement('button');b.textContent=i+1;b.setAttribute('aria-label',(i+1)+' layers: '+name);b.onclick=()=>choose(i+1);$('layers').append(b);});choose(8);
 async function stop(){
  ++epoch;const wasActive=active,position=audio.getTransport().beats*60/122;active=false;
  $('live').hidden=true;$('try-flow').hidden=false;
  await audio.pause();if(wasActive&&Number.isFinite(record.duration))record.currentTime=position%record.duration;
 }
 $('try-flow').onclick=async()=>{
  if(loading)return;const token=++epoch;loading=true;$('try-flow').disabled=true;record.pause();previous.pause();
  $('live').hidden=false;$('status').textContent='Loading the eight parts…';
  try{await audio.restart(record.currentTime*122/60);if(token!==epoch)return;active=true;$('try-flow').hidden=true;$('status').textContent='Playing · choose a layer to hear what it adds.';}
  catch(error){$('status').textContent='The layers could not load. The full track is still available.';}
  finally{loading=false;$('try-flow').disabled=false;}
 };
 $('stop-flow').onclick=async()=>{await stop();await record.play().catch(()=>{});};
 record.addEventListener('play',async()=>{previous.pause();if(active||loading)await stop();});
 previous.addEventListener('play',async()=>{record.pause();if(active||loading)await stop();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){record.pause();previous.pause();if(active||loading)stop();}});
 window.addEventListener('pagehide',()=>{record.pause();previous.pause();audio.dispose();});
})();
