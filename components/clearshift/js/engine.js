/* Clearshift — deterministic, presentation-independent rules. Original work, 2026. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.ClearshiftEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SIZE = 8;
  const DEFINITIONS = [
    ['dot', 'Single', [[0,0]], 2],
    ['two-h', 'Pair across', [[0,0],[0,1]], 3],
    ['two-v', 'Pair down', [[0,0],[1,0]], 3],
    ['three-h', 'Three across', [[0,0],[0,1],[0,2]], 3],
    ['three-v', 'Three down', [[0,0],[1,0],[2,0]], 3],
    ['corner-a', 'Small corner', [[0,0],[1,0],[1,1]], 3],
    ['corner-b', 'Small corner', [[0,0],[0,1],[1,0]], 3],
    ['corner-c', 'Small corner', [[0,0],[0,1],[1,1]], 3],
    ['corner-d', 'Small corner', [[0,1],[1,0],[1,1]], 3],
    ['square', 'Square', [[0,0],[0,1],[1,0],[1,1]], 4],
    ['four-h', 'Four across', [[0,0],[0,1],[0,2],[0,3]], 2],
    ['four-v', 'Four down', [[0,0],[1,0],[2,0],[3,0]], 2],
    ['ell-a', 'Tall corner', [[0,0],[1,0],[2,0],[2,1]], 2],
    ['ell-b', 'Wide corner', [[0,0],[0,1],[0,2],[1,0]], 2],
    ['tee', 'Tee', [[0,0],[0,1],[0,2],[1,1]], 2],
    ['step-h', 'Step across', [[0,0],[0,1],[1,1],[1,2]], 2],
    ['step-v', 'Step down', [[0,1],[1,0],[1,1],[2,0]], 2],
    ['six-h', 'Wide rectangle', [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]], 1],
    ['six-v', 'Tall rectangle', [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]], 1],
    ['five-h', 'Five across', [[0,0],[0,1],[0,2],[0,3],[0,4]], 1],
    ['five-v', 'Five down', [[0,0],[1,0],[2,0],[3,0],[4,0]], 1],
    ['nine', 'Large square', [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]], 1]
  ];
  const SHAPES = Object.fromEntries(DEFINITIONS.map(([id,name,cells,weight]) => [id,{id,name,cells,weight,
    width:Math.max(...cells.map(c=>c[1]))+1, height:Math.max(...cells.map(c=>c[0]))+1}]));
  const BAG = DEFINITIONS.flatMap(([id,,,weight])=>Array(weight).fill(id));
  const emptyBoard = () => Array.from({length:SIZE},()=>Array(SIZE).fill(0));
  const copyBoard = board => board.map(row=>row.slice());
  const clone = state => ({...state,board:copyBoard(state.board),tray:state.tray.map(s=>s?{...s}:null)});
  function nextRandom(seed) {
    let x = seed >>> 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const next = x >>> 0; return [next || 1, next / 4294967296];
  }
  function deal(state) {
    state.tray = Array.from({length:3},(_,i)=>{
      let value; [state.rng,value]=nextRandom(state.rng);
      return {id:BAG[Math.floor(value*BAG.length)],color:((state.deals+i)%3)+1};
    }); state.deals++;
  }
  function createGame(seed = Date.now() >>> 0) {
    const state={version:1,board:emptyBoard(),tray:[],rng:(seed>>>0)||1,seed:(seed>>>0)||1,
      score:0,lines:0,moves:0,shifts:0,shift:0,deals:0};
    deal(state); return state;
  }
  function canPlace(board, shapeOrId, row, col) {
    const shape = typeof shapeOrId === 'string' ? SHAPES[shapeOrId] : shapeOrId;
    return !!shape && Array.isArray(shape.cells) && Number.isInteger(row) && Number.isInteger(col) &&
      shape.cells.every(([r,c])=>r+row>=0 && r+row<SIZE && c+col>=0 && c+col<SIZE && !board[r+row][c+col]);
  }
  function placements(board, id) {
    const found=[];
    for(let row=0;row<SIZE;row++) for(let col=0;col<SIZE;col++) if(canPlace(board,id,row,col)) found.push([row,col]);
    return found;
  }
  function completedLines(board) {
    const rows=[],cols=[];
    for(let i=0;i<SIZE;i++) {
      if(board[i].every(Boolean)) rows.push(i);
      if(board.every(row=>!!row[i])) cols.push(i);
    }
    const cells=[];
    for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) if(rows.includes(r)||cols.includes(c)) cells.push([r,c]);
    return {rows,cols,cells,count:rows.length+cols.length};
  }
  function resolveLines(board) {
    const lines=completedLines(board), result=copyBoard(board);
    lines.cells.forEach(([r,c])=>{result[r][c]=0;});
    return {board:result,lines};
  }
  function previewPlacement(state, slot, row, col) {
    const piece=state.tray[slot];
    if(!piece || !canPlace(state.board,piece.id,row,col)) return {valid:false};
    const raw=copyBoard(state.board), cells=SHAPES[piece.id].cells.map(([r,c])=>[r+row,c+col]);
    cells.forEach(([r,c])=>{raw[r][c]=piece.color;});
    return {valid:true,raw,cells,...resolveLines(raw)};
  }
  function place(state,slot,row,col) {
    const preview=previewPlacement(state,slot,row,col);
    if(!preview.valid) return {ok:false,reason:'That shape needs more room.'};
    const next=clone(state), points=preview.cells.length*10+100*preview.lines.count**2;
    next.board=preview.board; next.tray[slot]=null; next.score+=points; next.moves++;
    next.lines+=preview.lines.count;
    if(preview.lines.count) next.shift=1;
    const refilled=next.tray.every(s=>!s);
    if(refilled) deal(next);
    return {ok:true,state:next,points,refilled,...preview};
  }
  function shiftedBoard(board,axis,index,direction) {
    if(!['row','col'].includes(axis)||!Number.isInteger(index)||index<0||index>=SIZE||![-1,1].includes(direction)) return null;
    const result=copyBoard(board);
    for(let i=0;i<SIZE;i++) {
      const dest=(i+direction+SIZE)%SIZE;
      if(axis==='row') result[index][dest]=board[index][i];
      else result[dest][index]=board[i][index];
    }
    return result;
  }
  function previewShift(state,axis,index,direction) {
    if(!state.shift) return {valid:false,reason:'Clear a line with a shape to earn a Shift.'};
    const raw=shiftedBoard(state.board,axis,index,direction);
    if(!raw) return {valid:false,reason:'Choose a row or column and a direction.'};
    if(raw.every((row,r)=>row.every((cell,c)=>cell===state.board[r][c]))) return {valid:false,reason:'That line would stay the same. Choose another.'};
    return {valid:true,raw,...resolveLines(raw)};
  }
  function shift(state,axis,index,direction) {
    const preview=previewShift(state,axis,index,direction);
    if(!preview.valid) return {ok:false,reason:preview.reason};
    const next=clone(state),points=100*preview.lines.count**2;
    next.board=preview.board; next.shift=0; next.shifts++; next.score+=points; next.lines+=preview.lines.count;
    return {ok:true,state:next,points,...preview};
  }
  function hasPlacement(board,tray) {
    return tray.some(piece=>piece && placements(board,piece.id).length>0);
  }
  function rescueShifts(state) {
    if(!state.shift) return [];
    const results=[];
    for(const axis of ['row','col']) for(let index=0;index<SIZE;index++) for(const direction of [-1,1]) {
      const preview=previewShift(state,axis,index,direction);
      if(preview.valid && hasPlacement(preview.board,state.tray)) results.push({axis,index,direction});
    }
    return results;
  }
  function status(state) {
    if(hasPlacement(state.board,state.tray)) return 'play';
    return rescueShifts(state).length ? 'shift-only':'over';
  }
  function validate(value) {
    if(!value || typeof value!=='object'||value.version!==1) return null;
    if(!Array.isArray(value.board)||value.board.length!==8||value.board.some(row=>!Array.isArray(row)||row.length!==8||row.some(v=>!Number.isInteger(v)||v<0||v>3))) return null;
    if(!Array.isArray(value.tray)||value.tray.length!==3||value.tray.every(s=>s===null)||value.tray.some(s=>s!==null&&(!s||typeof s.id!=='string'||!Object.hasOwn(SHAPES,s.id)||!Number.isInteger(s.color)||s.color<1||s.color>3))) return null;
    if(![0,1].includes(value.shift)) return null;
    for(const key of ['score','lines','moves','shifts','deals']) if(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>1e10) return null;
    for(const key of ['seed','rng']) if(!Number.isInteger(value[key])||value[key]<1||value[key]>4294967295) return null;
    if(completedLines(value.board).count) return null;
    // Construct a whitelist: imported objects never become live application objects.
    return {version:1,board:copyBoard(value.board),tray:value.tray.map(s=>s?{id:s.id,color:s.color}:null),
      seed:value.seed,rng:value.rng,shift:value.shift,score:value.score,lines:value.lines,moves:value.moves,shifts:value.shifts,deals:value.deals};
  }
  function serialize(state) { const valid=validate(state); if(!valid) throw new Error('Invalid run'); return JSON.stringify(valid); }
  function restore(text) { try {return validate(JSON.parse(text));} catch {return null;} }
  return {SIZE,SHAPES,emptyBoard,copyBoard,clone,createGame,canPlace,placements,completedLines,resolveLines,
    previewPlacement,place,shiftedBoard,previewShift,shift,hasPlacement,rescueShifts,status,validate,serialize,restore};
});
