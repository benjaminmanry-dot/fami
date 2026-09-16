'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../js/engine.js');
const piece=(id,color=1)=>({id,color});
function fixture(){const s=E.createGame(7001);s.board=E.emptyBoard();s.tray=[piece('dot'),piece('square'),piece('three-h')];return s;}

test('an intersecting row and column clear simultaneously; shared cell is removed once',()=>{
  const s=fixture();for(let i=0;i<8;i++){if(i!==2)s.board[3][i]=1;if(i!==3)s.board[i][2]=2;}
  const result=E.place(s,0,3,2);assert.equal(result.ok,true);assert.equal(result.lines.count,2);assert.equal(result.lines.cells.length,15);
  assert.equal(result.state.board.flat().filter(Boolean).length,0);assert.equal(result.state.score,410);assert.equal(result.state.lines,2);assert.equal(result.state.shift,1);
});
test('line clears award at most one Shift, including multiple lines and an already charged bank',()=>{
  const s=fixture();s.shift=1;for(let c=0;c<7;c++)s.board[0][c]=1;
  const result=E.place(s,0,0,7);assert.equal(result.state.shift,1);
});
test('failed placement and previews do not mutate the run',()=>{
  const s=fixture();s.board[0][0]=1;const before=JSON.stringify(s);
  assert.equal(E.place(s,1,0,0).ok,false);assert.equal(E.place(s,1,7,7).ok,false);
  E.previewPlacement(s,2,2,3);assert.equal(JSON.stringify(s),before);assert.equal(E.canPlace(s.board,'three-h',-1,0),false);
});
test('row and column Shift wrap exactly one square in both directions',()=>{
  for(const axis of ['row','col'])for(const direction of [-1,1]){
    const s=fixture();s.shift=1;const from=direction===1?7:0,to=direction===1?0:7;
    if(axis==='row')s.board[2][from]=3;else s.board[from][2]=3;
    const before=JSON.stringify(s),p=E.previewShift(s,axis,2,direction);assert.equal(p.valid,true);
    assert.equal(axis==='row'?p.raw[2][to]:p.raw[to][2],3);assert.equal(JSON.stringify(s),before);
    const result=E.shift(s,axis,2,direction);assert.equal(result.state.shift,0);assert.equal(result.state.shifts,1);
  }
});
test('a Shift can clear a column but cannot earn another Shift',()=>{
  const s=fixture();s.shift=1;for(let r=0;r<8;r++)if(r!==3)s.board[r][0]=2;s.board[3][7]=1;
  const result=E.shift(s,'row',3,1);assert.equal(result.lines.count,1);assert.equal(result.state.score,100);assert.equal(result.state.shift,0);assert.equal(result.state.board.flat().filter(Boolean).length,0);
});
test('a Shift that changes nothing is rejected without spending credit',()=>{
  const s=fixture();s.shift=1;assert.equal(E.shift(s,'row',3,1).ok,false);assert.equal(s.shift,1);
  assert.equal(E.shift(s,'bad',2,1).ok,false);assert.equal(E.shift(s,'row',8,1).ok,false);assert.equal(E.shift(s,'col',2,3).ok,false);
});
test('no-move detection finds a Shift rescue when no remaining shape fits',()=>{
  const s=fixture();s.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>(r+c)%2?1:0));s.tray=[piece('two-v'),null,null];
  assert.equal(E.status(s),'over');s.shift=1;assert.equal(E.status(s),'shift-only');
  const rescue=E.rescueShifts(s)[0];const next=E.shift(s,rescue.axis,rescue.index,rescue.direction).state;assert.equal(E.status(next),'play');
});
test('a banked Shift does not falsely prevent game over when no single Shift can rescue',()=>{
  const s=fixture();s.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>r===c?0:1));s.tray=[piece('nine'),null,null];s.shift=1;
  assert.equal(E.status(s),'over');assert.equal(E.rescueShifts(s).length,0);
});
test('the tray refills only after all three shapes are spent, preserving deterministic randomness',()=>{
  let s=fixture();s.tray=[piece('dot'),piece('dot'),piece('dot')];
  const first=E.place(s,0,0,0);assert.equal(first.refilled,false);assert.equal(first.state.tray[0],null);
  const second=E.place(first.state,1,0,1);assert.equal(second.refilled,false);
  const third=E.place(second.state,2,0,2);assert.equal(third.refilled,true);assert.equal(third.state.tray.filter(Boolean).length,3);
  assert.deepEqual(E.createGame(99),E.createGame(99));assert.notDeepEqual(E.createGame(99).tray,E.createGame(104).tray);
});
test('save restore validates data and continues the same future deal',()=>{
  const original=E.createGame(8844),restored=E.restore(E.serialize(original));assert.deepEqual(restored,original);
  assert.equal(E.restore('{oops'),null);assert.equal(E.restore('null'),null);
  for(const change of [{shift:2},{rng:0},{version:9},{score:-1},{score:Infinity},{board:[[1]]},{tray:[piece('missing'),null,null]},{tray:[null,null,null]}])assert.equal(E.restore(JSON.stringify({...original,...change})),null);
  const dirty={...original,extra:'discarded'};assert.equal('extra' in E.validate(dirty),false);
  for(const id of ['__proto__','constructor','toString',['dot'],null])assert.equal(E.restore(JSON.stringify({...original,tray:[piece(id),null,null]})),null);
  assert.equal(E.canPlace(original.board,'constructor',0,0),false);
  const unresolved=E.clone(original);unresolved.board[0].fill(1);assert.equal(E.validate(unresolved),null);
  let a=original,b=restored;
  for(let turn=0;turn<30;turn++){
    let found=false;
    for(let slot=0;slot<3;slot++){if(!a.tray[slot])continue;const fits=E.placements(a.board,a.tray[slot].id);if(!fits.length)continue;const pos=fits[0];a=E.place(a,slot,...pos).state;b=E.place(b,slot,...pos).state;found=true;break;}
    assert.deepEqual(a,b);if(!found)break;
  }
});
test('100 deterministic runs preserve occupancy, score and serialization invariants through placement and rescue',()=>{
  for(let seed=1;seed<=100;seed++){
    let state=E.createGame(seed);
    for(let move=0;move<150;move++){
      const status=E.status(state);if(status==='over')break;
      if(status==='shift-only'){const s=E.rescueShifts(state)[0];state=E.shift(state,s.axis,s.index,s.direction).state;}
      else {
        const candidates=[];state.tray.forEach((p,slot)=>{if(p)E.placements(state.board,p.id).forEach(([r,c])=>candidates.push({slot,r,c,result:E.previewPlacement(state,slot,r,c)}));});
        candidates.sort((a,b)=>b.result.lines.count-a.result.lines.count||a.r-b.r||a.c-b.c);
        const best=candidates[0],before=state.score;state=E.place(state,best.slot,best.r,best.c).state;assert.ok(state.score>before);
      }
      assert.equal(E.completedLines(state.board).count,0);assert.ok(state.shift===0||state.shift===1);assert.deepEqual(E.restore(E.serialize(state)),state);
    }
  }
});
