// Deterministic planning probe. These are simulations, not human playtests.
'use strict';
const E=require('../js/sweep-engine.js');
const fs=require('node:fs');
function fitness(s){
 const b=s.board.map((row,r)=>row.map((v,c)=>s.charge[r][c]?0:v));
 let occupied=0,cohesion=0,isolated=0,squares=0;
 for(let r=0;r<8;r++){const n=b[r].filter(Boolean).length;occupied+=n;cohesion+=n*n*n;}
 for(let c=0;c<8;c++){let n=0;for(let r=0;r<8;r++)if(b[r][c])n++;cohesion+=n*n*n;}
 for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(!b[r][c]){
   const neighbors=[[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([y,x])=>y>=0&&y<8&&x>=0&&x<8);
   if(neighbors.every(([y,x])=>b[y][x]))isolated++;
   if(r<7&&c<7&&!b[r+1][c]&&!b[r][c+1]&&!b[r+1][c+1])squares++;
 }
 return cohesion*.22-occupied*8-isolated*18+squares*.4;
}
function choose(s){
 let best=null;
 for(let slot=0;slot<3;slot++)if(s.tray[slot])for(let r=0;r<8;r++)for(let c=0;c<8;c++){
   const p=E.place(s,slot,r,c);if(!p.ok)continue;
   const score=fitness(p.state)+p.lines.cells.length*34+p.cells.length*1.5;
   if(!best||score>best.value)best={slot,r,c,value:score,result:p};
 }
 return best;
}
function advance(s,seconds){
 const beats=s.beats+seconds*112/60,passes=[];
 while(s.step<=Math.floor(beats/2)){
   const n=E.sweep(s);s=n.state;if(n.lap)passes.push(n.lap);
 }s.beats=beats;return {state:s,passes};
}
function simulate(seed,secondsPerMove,limit=600){
 let s=E.createGame(seed),time=0,passes=[],rescues=0,route=[{scene:0,time:0}],last=0;
 for(let i=0;i<limit;i++){
   const next=advance(s,secondsPerMove);s=next.state;time+=secondsPerMove;passes.push(...next.passes);
   const c=choose(s);
   if(c)s=c.result.state;
   else if(E.pending(s)){i--;if(time>3600)break;continue;}
   else {const rescue=E.findRescue(s);if(!rescue)break;const lift=E.pickup(s,rescue.slot,...rescue.source);s=E.drop(lift.state,...rescue.target).state;rescues++;}
   if(E.scene(s.score)>last){last=E.scene(s.score);route.push({scene:last,time});}
 }
 return {seed,secondsPerMove,score:s.score,moves:s.moves,lines:s.lines,time,bestFlow:s.bestFlow,scene:E.scene(s.score),rescues,route,passes:passes.map(p=>({paint:p.paint,flow:p.flow}))};
}
if(require.main===module){
 const results=[];for(const pace of [1.25,2.5,5])for(const seed of [112,2468,987654])results.push(simulate(seed,pace));
 fs.writeFileSync(__dirname+'/../evidence-v3/balance-simulation.json',JSON.stringify({kind:'heuristic simulation, not human play',results},null,2));
 console.log(results.map(({passes,...summary})=>summary));
}
module.exports={choose,fitness,simulate};
