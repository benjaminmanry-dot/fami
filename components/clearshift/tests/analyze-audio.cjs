const fs=require('node:fs'),path=require('node:path');
const file=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../evidence-v3/rooftop-flow-demonstration.wav');
const b=fs.readFileSync(file),sampleRate=b.readUInt32LE(24),frames=(b.length-44)/4;
let peak=0,sum=0,clipped=0,diff=0,nonzero=0;
const windows=[];
for(let start=0;start<frames;start+=sampleRate*5){
  let p=0,ss=0;const end=Math.min(frames,start+sampleRate*5);
  for(let i=start;i<end;i++){
    const l=b.readInt16LE(44+i*4)/32768,r=b.readInt16LE(46+i*4)/32768;
    peak=Math.max(peak,Math.abs(l),Math.abs(r));p=Math.max(p,Math.abs(l),Math.abs(r));sum+=l*l+r*r;ss+=l*l+r*r;diff+=(l-r)**2;
    if(Math.abs(l)>=32767/32768)clipped++;if(Math.abs(r)>=32767/32768)clipped++;if(l||r)nonzero++;
  }
  windows.push({fromSeconds:start/sampleRate,rmsDbFS:+(20*Math.log10(Math.sqrt(ss/((end-start)*2)))).toFixed(2),peakDbFS:+(20*Math.log10(p)).toFixed(2)});
}
const result={format:'16-bit PCM WAV',durationSeconds:frames/sampleRate,sampleRate,channels:2,bytes:b.length,
  peak,peakDbFS:20*Math.log10(peak),rmsDbFS:20*Math.log10(Math.sqrt(sum/(frames*2))),clippedSamples:clipped,
  nonzeroFrameFraction:nonzero/frames,stereoDifferenceRms:Math.sqrt(diff/frames),windows,
  final20msSilent:b.subarray(b.length-Math.floor(sampleRate*0.02)*4).every(value=>value===0),
  provenance:'PCM signal inspection. See the adjacent source record to distinguish a studio listening mix from the scripted browser flow demonstration. Neither is a recording of earned gameplay.',
  listening:'No reliable listening channel was available to the production owner. These are signal checks, not a listening endorsement.'};
fs.writeFileSync(path.join(path.dirname(file),'audio-pcm-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
