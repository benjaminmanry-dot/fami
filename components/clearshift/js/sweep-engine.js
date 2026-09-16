/* Clearshift v2. Pure rules: paint, lift, relocate, charge and sweep. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine.js'),require('./progression.js'));
  else root.ClearshiftEngine=factory(root.ClearshiftEngine,root.ClearshiftProgression);
})(globalThis,function(Base,Progression){
  'use strict';
  const {SIZE,SHAPES,emptyBoard,copyBoard,canPlace,placements,completedLines}=Base;
  const integer=(n,min=0,max=1e10)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const validSlot=(s,i)=>integer(i,0,2)&&s.tray[i];
  const clone=s=>({...s,board:copyBoard(s.board),charge:copyBoard(s.charge),tray:s.tray.map(p=>p?{...p}:null),held:s.held?{...s.held,pieces:s.held.pieces.map(p=>({...p}))}:null});
  function createGame(seed){return {...Base.createGame(seed),version:3,charge:emptyBoard(),held:null,step:0,beats:0,flow:1,flowEnergy:0,strongStreak:0,lapPaint:0,paint:0,bestFlow:1};}
  function deal(s){
    const next=Base.createGame(s.rng);s.rng=next.rng;
    s.tray=next.tray.map((p,i)=>({...p,color:1+(s.deals+i)%3}));s.deals++;
  }
  function prime(s,kind){
    const full=completedLines(s.board);
    const rows=full.rows.filter(r=>s.charge[r].some(q=>!q));
    const cols=full.cols.filter(c=>s.charge.some(row=>!row[c]));
    const cells=[];
    for(let r=0;r<8;r++)for(let c=0;c<8;c++)if((rows.includes(r)||cols.includes(c))&&!s.charge[r][c]){s.charge[r][c]=kind==='place'?1:2;cells.push([r,c]);}
    const count=rows.length+cols.length;s.lines+=count;
    if(count&&kind==='place')s.shift=1;
    return {rows,cols,cells,count};
  }
  function previewPlacement(s,slot,r,c){
    if(s.held||!validSlot(s,slot)||!canPlace(s.board,s.tray[slot].id,r,c))return {valid:false,reason:'The paint needs empty squares.'};
    const cells=SHAPES[s.tray[slot].id].cells.map(([dr,dc])=>[r+dr,c+dc]);
    return {valid:true,cells};
  }
  function place(s,slot,r,c){
    const p=previewPlacement(s,slot,r,c);if(!p.valid)return {ok:false,reason:p.reason};
    const next=clone(s);p.cells.forEach(([rr,cc])=>{next.board[rr][cc]=s.tray[slot].color;});
    next.moves++;next.score+=p.cells.length*10;next.tray[slot]=null;
    const lines=prime(next,'place'),refilled=next.tray.every(p=>!p);if(refilled)deal(next);
    return {ok:true,state:next,cells:p.cells,lines,points:p.cells.length*10,refilled};
  }
  function previewPickup(s,slot,r,c){
    if(!s.shift||s.held||!validSlot(s,slot))return {valid:false,reason:'Earn a Shift, then choose an offered stencil.'};
    const shape=SHAPES[s.tray[slot].id];
    if(!integer(r,0,7)||!integer(c,0,7)||r+shape.height>8||c+shape.width>8)return {valid:false,reason:'Keep the stencil inside the board.'};
    const pieces=shape.cells.filter(([dr,dc])=>s.board[r+dr][c+dc]).map(([dr,dc])=>({r:dr,c:dc,color:s.board[r+dr][c+dc],charge:s.charge[r+dr][c+dc]}));
    if(!pieces.length)return {valid:false,reason:'There is no paint under that stencil.'};
    return {valid:true,pieces,cells:pieces.map(p=>[r+p.r,c+p.c]),footprint:shape.cells.map(([dr,dc])=>[r+dr,c+dc])};
  }
  function pickup(s,slot,r,c){
    const p=previewPickup(s,slot,r,c);if(!p.valid)return {ok:false,reason:p.reason};
    const next=clone(s);p.cells.forEach(([rr,cc])=>{next.board[rr][cc]=0;next.charge[rr][cc]=0;});
    next.held={slot,row:r,col:c,pieces:p.pieces};
    return {ok:true,state:next,cells:p.cells};
  }
  function previewDrop(s,r,c){
    if(!s.held||!integer(r,-7,7)||!integer(c,-7,7))return {valid:false,reason:'Pick up some paint first.'};
    const pieces=s.held.pieces,cells=pieces.map(p=>[r+p.r,c+p.c]);
    if(cells.some(([rr,cc])=>rr<0||rr>7||cc<0||cc>7||s.board[rr][cc]))return {valid:false,cells,reason:'Only the carried blocks need empty landing squares.'};
    if(r===s.held.row&&c===s.held.col)return {valid:false,cells,reason:'Move the paint somewhere new, or cancel.'};
    return {valid:true,cells};
  }
  function drop(s,r,c){
    const p=previewDrop(s,r,c);if(!p.valid)return {ok:false,reason:p.reason};
    const next=clone(s);next.held.pieces.forEach(b=>{next.board[r+b.r][c+b.c]=b.color;next.charge[r+b.r][c+b.c]=b.charge;});
    next.held=null;next.shift=0;next.shifts++;const lines=prime(next,'shift');
    return {ok:true,state:next,cells:p.cells,lines,points:0};
  }
  function cancelPickup(s){
    if(!s.held)return {ok:true,state:clone(s)};
    const next=clone(s),h=next.held;
    if(h.pieces.some(p=>next.board[h.row+p.r][h.col+p.c]))return {ok:false,reason:'Original paint positions are occupied.'};
    h.pieces.forEach(p=>{next.board[h.row+p.r][h.col+p.c]=p.color;next.charge[h.row+p.r][h.col+p.c]=p.charge;});
    next.held=null;return {ok:true,state:next};
  }
  function sweep(s){
    const next=clone(s),column=s.step%8,cells=[];let lap=null;
    if(s.step>0&&column===0){
      const productive=s.lapPaint>=4;
      Object.assign(next,Progression.resolveFlow(s));
      next.bestFlow=Math.max(s.bestFlow,next.flow);lap={paint:s.lapPaint,productive,flow:next.flow,previousFlow:s.flow};next.lapPaint=0;
    }
    for(let r=0;r<8;r++)if(next.charge[r][column]){
      cells.push({r,c:column,color:next.board[r][column]});next.board[r][column]=0;next.charge[r][column]=0;
    }
    const points=cells.length*25*Progression.multiplier(next.flow);
    next.score+=points;next.lapPaint+=cells.length;next.paint+=cells.length;next.step++;
    return {ok:true,state:next,column,cells,points,lap};
  }
  function hasPlacement(board,tray){
    for(const p of tray)if(p)for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(canPlace(board,p.id,r,c))return true;return false;
  }
  function pending(s){return s.charge.some(row=>row.some(Boolean));}
  function findRescue(s){
    if(!s.shift||s.held)return null;
    for(let slot=0;slot<3;slot++)if(s.tray[slot])for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      const lifted=pickup(s,slot,r,c);if(!lifted.ok)continue;
      const payload=lifted.state.held.pieces,minR=Math.min(...payload.map(p=>p.r)),maxR=Math.max(...payload.map(p=>p.r)),minC=Math.min(...payload.map(p=>p.c)),maxC=Math.max(...payload.map(p=>p.c));
      for(let dr=-minR;dr<8-maxR;dr++)for(let dc=-minC;dc<8-maxC;dc++){
        if(!previewDrop(lifted.state,dr,dc).valid)continue;
        const moved=drop(lifted.state,dr,dc).state;
        if(pending(moved)||hasPlacement(moved.board,moved.tray))return {slot,source:[r,c],target:[dr,dc]};
      }
    }return null;
  }
  function status(s){
    if(s.held)return 'held';if(hasPlacement(s.board,s.tray))return 'play';
    if(pending(s))return 'waiting';return findRescue(s)?'shift-only':'over';
  }
  function validate(v){
    if(!v||v.version!==3)return null;
    const grid=(b,max)=>Array.isArray(b)&&b.length===8&&b.every(row=>Array.isArray(row)&&row.length===8&&row.every(n=>integer(n,0,max)));
    if(!grid(v.board,3)||!grid(v.charge,2)||v.charge.some((row,r)=>row.some((q,c)=>q&&!v.board[r][c])))return null;
    if(!Array.isArray(v.tray)||v.tray.length!==3||v.tray.every(p=>p===null)||v.tray.some(p=>p!==null&&(!p||typeof p.id!=='string'||!Object.hasOwn(SHAPES,p.id)||!integer(p.color,1,3))))return null;
    for(const k of ['score','lines','moves','shifts','deals','step','lapPaint','paint'])if(!integer(v[k]))return null;
    if(!integer(v.shift,0,1)||!integer(v.flow,1,8)||!integer(v.bestFlow,v.flow,8)||!integer(v.flowEnergy,0,240)||!integer(v.strongStreak,0,99)||v.flow!==Progression.flowFor(v.flowEnergy,v.strongStreak)||!integer(v.seed,1,4294967295)||!integer(v.rng,1,4294967295))return null;
    if(!Number.isFinite(v.beats)||v.beats<0||v.beats>1e10)return null;
    // A persisted clock cannot request millions of catch-up columns on reload.
    if(v.step<Math.floor(v.beats/2)||v.step>Math.floor(v.beats/2)+1)return null;
    let held=null;
    if(v.held){
      const h=v.held;if(!v.shift||!integer(h.slot,0,2)||!v.tray[h.slot]||!integer(h.row,0,7)||!integer(h.col,0,7)||!Array.isArray(h.pieces)||!h.pieces.length)return null;
      const shape=SHAPES[v.tray[h.slot].id],seen=new Set();if(h.row+shape.height>8||h.col+shape.width>8)return null;
      for(const p of h.pieces){
        if(!p||!integer(p.r,0,7)||!integer(p.c,0,7)||!shape.cells.some(([r,c])=>r===p.r&&c===p.c)||!integer(p.color,1,3)||!integer(p.charge,0,2)||v.board[h.row+p.r][h.col+p.c])return null;
        const key=p.r*8+p.c;if(seen.has(key))return null;seen.add(key);
      }
      held={slot:h.slot,row:h.row,col:h.col,pieces:h.pieces.map(p=>({r:p.r,c:p.c,color:p.color,charge:p.charge}))};
    }
    const out={version:3,board:copyBoard(v.board),charge:copyBoard(v.charge),tray:v.tray.map(p=>p?{id:p.id,color:p.color}:null),held,beats:v.beats};
    for(const k of ['score','lines','moves','shifts','deals','step','lapPaint','paint','shift','flow','flowEnergy','strongStreak','bestFlow','seed','rng'])out[k]=v[k];return out;
  }
  function serialize(s){const v=validate(s);if(!v)throw Error('Invalid Clearshift run');return JSON.stringify(v);}
  function restore(text){try{return validate(JSON.parse(text));}catch{return null;}}
  return {SIZE,SHAPES,emptyBoard,copyBoard,clone,createGame,canPlace,placements,completedLines,previewPlacement,place,previewPickup,pickup,previewDrop,drop,cancelPickup,sweep,hasPlacement,pending,findRescue,status,validate,serialize,restore,...Progression};
});
