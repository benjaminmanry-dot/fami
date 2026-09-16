/* One source for the city's route and its earned musical intensity. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ClearshiftProgression=factory();
})(globalThis,function(){
  'use strict';
  const DISTRICTS=Object.freeze([
    {name:'Rooftop Radio',score:0,art:'rooftop.png',material:'Cut-paper stickers'},
    {name:'After Hours',score:800,art:'underpass.png',material:'Iridescent facets'},
    {name:'Wild Current',score:2200,art:'wildstyle.png',material:'Bubble-letter enamel'},
    {name:'Sunrail Market',score:4500,art:'sunrail-market.png',material:'Screen-printed stamps'},
    {name:'Cobalt Arcade',score:8000,art:'cobalt-arcade.png',material:'Electric inlays'},
    {name:'Canopy Line',score:13000,art:'canopy-line.png',material:'Layered glass'},
    {name:'Chrome Harbor',score:20000,art:'chrome-harbor.png',material:'Brushed chrome'},
    {name:'Solar Steps',score:30000,art:'solar-steps.png',material:'Sun-cut mosaics'},
    {name:'Skywide',score:45000,art:'skywide.png',material:'Prismatic wildstyle'}
  ]);
  const FLOW_NAMES=Object.freeze(['Pocket','Headnod','Locked in','Lift','Drive','Heat','Ignition','Wildstyle']);
  const FLOW_THRESHOLDS=Object.freeze([0,12,30,54,84,120,162,210]);
  function scene(score){let i=0;while(i<8&&score>=DISTRICTS[i+1].score)i++;return i;}
  function multiplier(flow){return 1+Math.floor((flow-1)/2);}
  function flowFor(energy,strongStreak){
    let flow=1;while(flow<8&&energy>=FLOW_THRESHOLDS[flow])flow++;
    return flow===8&&strongStreak<3?7:flow;
  }
  function resolveFlow(s){
    const paint=s.lapPaint, strongStreak=paint>=16?Math.min(99,s.strongStreak+1):0;
    let energy=s.flowEnergy;
    if(paint<4)energy=Math.max(0,energy-(paint===0?20:12));
    else {
      const ceiling=paint>=16?240:paint>=12?209:paint>=8?161:83;
      const gain=paint>=16?22:paint>=12?16:paint>=8?10:4;
      energy=energy>ceiling?Math.max(ceiling,energy-8):Math.min(ceiling,energy+gain);
    }
    return {flowEnergy:energy,strongStreak,flow:flowFor(energy,strongStreak)};
  }
  function flowHint(s){
    const count=s.lapPaint+' collected this pass. ';
    if(s.flow===8)return count+'16+ keeps Wildstyle alive.';
    if(s.flowEnergy>=210)return count+'Wildstyle: '+Math.min(3,s.strongStreak)+'/3 strong passes.';
    if(s.flow>=6)return count+'Aim for 16+ to reach Wildstyle.';
    if(s.flow>=4)return count+'12+ builds the upper tiers.';
    return count+'8+ builds a stronger groove.';
  }
  return {DISTRICTS,FLOW_NAMES,FLOW_THRESHOLDS,scene,multiplier,flowFor,resolveFlow,flowHint};
});
