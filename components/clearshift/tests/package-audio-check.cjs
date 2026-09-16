const fs=require('fs'), path=require('path');
const root=path.resolve(__dirname,'..'), music=path.join(root,'assets','music');
const scenes=['rooftop-radio','after-hours','wild-current','sunrail-market','cobalt-arcade','canopy-line','chrome-harbor','solar-steps','skywide'];
const stems=['01-base','02-keys','03-guitar','04-mallet','05-chops','06-horns','07-counter','08-lead'];
function wavInfo(file){const b=fs.readFileSync(file);if(b.subarray(0,4).toString()!=='RIFF'||b.subarray(8,12).toString()!=='WAVE')throw Error('not WAV '+file);return {channels:b.readUInt16LE(22),rate:b.readUInt32LE(24),bits:b.readUInt16LE(34),bytes:b.readUInt32LE(40)};}
const lengths=[];
let maxBoundaryJump=0;
for(const [i,slug] of scenes.entries()){
  const folder=path.join(music,String(i).padStart(2,'0')+'-'+slug);let reference=null;
  for(const stem of stems){const file=path.join(folder,stem+'.wav'),info=wavInfo(file),b=fs.readFileSync(file);if(info.channels!==1||info.rate!==32000||info.bits!==16)throw Error('bad stem format '+stem);if(reference==null)reference=info.bytes;else if(info.bytes!==reference)throw Error('unsynchronized stem '+folder);const jump=Math.abs(b.readInt16LE(44)-b.readInt16LE(b.length-2));maxBoundaryJump=Math.max(maxBoundaryJump,jump);if(jump>1)throw Error('loop boundary click risk '+file+' jump '+jump);lengths.push(info.bytes);}
  if(Math.abs(reference/2/32000-128*60/112)>1/32000)throw Error('wrong 128-beat duration '+folder);
  for(const stem of stems){const b=fs.readFileSync(path.join(folder,stem+'.wav'));let firstPhrasePeak=0;for(let j=44;j<Math.min(b.length,44+Math.floor(16*60/112*32000)*2);j+=2)firstPhrasePeak=Math.max(firstPhrasePeak,Math.abs(b.readInt16LE(j)));if(firstPhrasePeak<100)throw Error('tier reward missing from opening phrase '+folder+'/'+stem);}
  const mix=wavInfo(path.join(folder,'full-mix.wav'));if(mix.channels!==2||mix.rate!==32000||mix.bits!==16||mix.bytes!==reference*2)throw Error('bad listening mix '+folder);
  const midi=fs.readFileSync(path.join(folder,`${String(i).padStart(2,'0')}-${slug}.mid`));if(midi.subarray(0,4).toString()!=='MThd'||midi.readUInt16BE(10)!==3||!midi.includes(Buffer.from([0xc0,33]))||!midi.includes(Buffer.from([0xc1,27])))throw Error('bad editable MIDI '+slug);
}
if(!fs.readFileSync(path.join(root,'.gitignore'),'utf8').includes('**/private-licensed-input/'))throw Error('private production input exclusion missing');
console.log(`package audio: ${scenes.length} scenes, ${stems.length} aligned 32 kHz stems each, ${lengths.length} WAV stems and 9 MIDI arrangements passed; max end-to-start jump ${maxBoundaryJump}`);

// The new flagship has a different tempo, twice the form, and native stereo.
const flagship=path.join(music,'00-cut-it-loose');
const newStems=['01-core','02-breaks','03-guitar','04-cuts','05-percussion','06-bass-drive','07-turntable','08-finale'];
const frames=Math.round(256*60/122*32000),sum=new Float64Array(frames*2);
for(const name of newStems){
 const file=path.join(flagship,name+'.wav'),b=fs.readFileSync(file),info=wavInfo(file);
 if(info.channels!==2||info.rate!==32000||info.bits!==16||info.bytes!==frames*4)throw Error('invalid new flagship stem '+name);
 let early=0;
 for(let j=0;j<frames*2;j++){
  const sample=b.readInt16LE(44+j*2)/32768;sum[j]+=sample;
  if(Math.abs(sample)>=1)throw Error('clipped flagship stem '+name);
  if(j<Math.round(32*60/122*32000)*2)early=Math.max(early,Math.abs(sample));
 }
 for(const at of [44,46,b.length-4,b.length-2])if(b.readInt16LE(at)!==0)throw Error('nonzero stereo loop edge '+name);
 if(early<.003)throw Error('flagship layer lacks an opening reward '+name);
}
const masterFile=path.join(flagship,'full-mix.wav'),master=fs.readFileSync(masterFile),info=wavInfo(masterFile);
if(info.channels!==2||info.bits!==24||info.rate!==32000||info.bytes!==frames*6)throw Error('invalid flagship master');
let difference=0,peak=0;
for(let i=0;i<sum.length;i++){const sample=master.readIntLE(44+i*3,3)/8388608;difference=Math.max(difference,Math.abs(sample-sum[i]));peak=Math.max(peak,Math.abs(sample));}
if(difference>.0003||peak>=1)throw Error('flagship sum or master headroom failed');
console.log(`new flagship: 8 stereo stems, 256 beats at 122 BPM, zero loop edges; stem sum error ${difference.toFixed(7)}, master peak ${peak.toFixed(5)}`);
