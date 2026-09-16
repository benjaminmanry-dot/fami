/* Optional, offline-only proof renderer. It never starts live playback. */
async function renderClearshiftProof(seconds=72) {
  window.__csProofStatus='rendering';window.__csProofError=null;
  try {
    const b=await ClearshiftAudio.renderProof(seconds,{assetBase:'../assets/music/'}),n=b.length,sr=b.sampleRate;
    const left=b.getChannelData(0),right=b.getChannelData(1),buffer=new ArrayBuffer(44+n*4),view=new DataView(buffer);
    function label(offset,text){for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));}
    label(0,'RIFF');view.setUint32(4,36+n*4,true);label(8,'WAVE');label(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,sr,true);
    view.setUint32(28,sr*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);label(36,'data');view.setUint32(40,n*4,true);
    let peak=0,sum=0,clipped=0,nonfinite=0,diff=0;
    for(let i=0;i<n;i++){
      for(let ch=0;ch<2;ch++){
        const sample=ch?right[i]:left[i];if(!Number.isFinite(sample))nonfinite++;
        peak=Math.max(peak,Math.abs(sample));sum+=sample*sample;if(Math.abs(sample)>=1)clipped++;
        view.setInt16(44+i*4+ch*2,Math.round(Math.max(-1,Math.min(1,sample))*32767),true);
      }diff+=(left[i]-right[i])**2;
    }
    window.__csWav=new Uint8Array(buffer);
    window.__csAudioStats={seconds:n/sr,sampleRate:sr,channels:2,bytes:buffer.byteLength,peak,peakDbFS:20*Math.log10(peak),rmsDbFS:20*Math.log10(Math.sqrt(sum/(n*2))),clippedSamples:clipped,nonfiniteSamples:nonfinite,stereoDifferenceRms:Math.sqrt(diff/n)};
    window.__csProofStatus='complete';return window.__csAudioStats;
  }catch(error){window.__csProofStatus='failed';window.__csProofError=String(error);throw error;}
}
