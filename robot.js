import {MergeSimulator} from './simulator.js';

export const STRATEGIES = {
  orders: {name:'先交订单',icon:'📦',hint:'先做离交付最近的物品'},
  inventory: {name:'先用库存',icon:'🧩',hint:'先合成、加工现有材料，再生成'},
  space: {name:'先腾空间',icon:'✨',hint:'优先合并多余物品，保留订单材料'}
};
export const ACTION_SECONDS = {generate:.8,merge:.65,craft:1.1,submit:1.2,move:.55,remove:.4,refill:0};
const clone = value => JSON.parse(JSON.stringify(value));

// This policy layer only chooses legal board actions. It never modifies game configuration.
export class RobotSimulator extends MergeSimulator {
  constructor(data,day,options={}) {
    super(data,day,options);
    this.policy={strategy:'orders',focus:'auto'};
    this.elapsed=0;this.lastAction=null;this.energyTrace=[{step:0,value:this.energy}];
    this.initialEnergy=this.energy;this.refilled=0;
    if(options.layout!==undefined) this.applyOpening(options.layout,options.energy??this.energy);
    else if(options.energy!==undefined) this.applyOpening(this.exportLayout(),options.energy);
    this.setPolicy(options.strategy??'orders',options.focus??'auto');
  }
  exportLayout(){return this.cells.map(t=>t?.name??null)}
  validateOpening(layout,energy){
    if(!Array.isArray(layout)||layout.length!==56)throw Error('初始棋盘需要56个格子');
    if(!Number.isInteger(energy)||energy<0||energy>1000000)throw Error('初始体力请输入0到1000000的整数');
    layout.forEach((name,index)=>{
      if(index>=48&&name!==null)throw Error('底部8个生成器位置不能放物品');
      if(name===null)return;
      const item=this.items.get(name);
      if(typeof name!=='string'||!item||item.error)throw Error('初始棋盘含无法模拟的物品');
      if(item.store&&item.store!==this.day.store)throw Error('物品不属于当前店铺');
      if(item.recipeStore&&/^\d+$/.test(item.recipeStore)&&Number(item.recipeStore)>this.day.store)throw Error('物品尚未解锁');
    });
  }
  applyOpening(layout,energy){
    this.validateOpening(layout,energy);
    for(let i=0;i<48;i++)this.cells[i]=layout[i]?{name:layout[i],id:++this.uid}:null;
    this.energy=energy;this.initialEnergy=energy;this.spent=0;this.cursor=0;this.merges=0;this.crafts=0;
    this.delivered=0;this.actions=0;this.elapsed=0;this.refilled=0;this.fractions={};this.clicks={};
    this.history=[];this.last=[];this.lastAction=null;this.failure='';this.log=[];
    this.peakOccupancy=56-this.free();this.energyTrace=[{step:0,value:energy}];
    this.note('已摆好初始棋盘');
  }
  snapshot(){return {...super.snapshot(),elapsed:this.elapsed??0,initialEnergy:this.initialEnergy??this.energy,refilled:this.refilled??0,lastAction:clone(this.lastAction??null),energyTrace:clone(this.energyTrace??[{step:0,value:this.energy}])}}
  setPolicy(strategy,focus='auto'){
    if(!STRATEGIES[strategy])throw Error('未知机器人策略');
    if(!['auto','os_1','os_2','os_3','os_4','os_5','os_6','os_7','被动'].includes(focus))throw Error('未知优先生成器');
    this.policy={strategy,focus};return this.policy;
  }
  actionDone(message){
    const result=super.actionDone(message);
    this.lastAction=null;
    if(this.energyTrace){this.energyTrace.push({step:this.actions,value:this.energy});if(this.energyTrace.length>480)this.energyTrace=this.energyTrace.filter((_,i)=>i%2===0||i===this.energyTrace.length-1)}
    return result;
  }
  refill(){const r=super.refill();if(r.ok)this.refilled+=100;return r}
  generatorFor(item){return item?.chain?.includes('_a_')?'被动':item?.chain?`os_${item.chain.split('_')[1]}`:null}
  reservedStock(){
    const available=new Map();this.cells.forEach((t,i)=>{if(t?.name){if(!available.has(t.name))available.set(t.name,[]);available.get(t.name).push(i)}});
    const missing=[];
    for(const name of this.demands()){const ids=available.get(name);if(ids?.length)ids.shift();else missing.push(name)}
    return {available,missing};
  }
  missingCost(name,available,trail=new Set(),quantity=1){
    if(trail.has(name)||trail.size>40)return 1e9;
    const ids=available.get(name);if(ids?.length){const used=Math.min(quantity,ids.length);ids.splice(0,used);quantity-=used}if(quantity===0)return 0;
    const item=this.items.get(name);if(!item||item.error)return 1e9;
    const next=new Set(trail).add(name),ing=this.ingredients(name);
    if(ing?.length){const counts=new Map();ing.forEach(n=>counts.set(n,(counts.get(n)||0)+quantity));return (item.extra||0)*quantity+[...counts].reduce((s,[n,q])=>s+this.missingCost(n,available,next,q),0)}
    if(item.chain&&item.level>1){const prev=this.base.get(`${item.chain}:${item.level-1}`);return prev?this.missingCost(prev,available,next,quantity*2):1e9}
    const eff=this.current()?.eff[item.chain]||0;return eff>0?quantity/eff:1e9;
  }
  planFor(name,available,trail=new Set()){
    if(trail.has(name)||trail.size>40)return {type:'error',message:'配方存在循环，暂时无法继续'};
    const ids=available.get(name);if(ids?.length)return {ready:true,indices:[ids.shift()]};
    const item=this.items.get(name);if(!item||item.error)return {type:'error',message:'这个物品的配置需要核对'};
    const next=new Set(trail).add(name),ing=this.ingredients(name);
    if(ing?.length){
      // Reserve already complete ingredients before choosing a missing branch. A policy
      // can change the next sub-recipe even when an order asks for just one final item.
      const material=Array(ing.length),missing=[];
      ing.forEach((n,index)=>{const ids=available.get(n);if(ids?.length)material[index]=ids.shift();else missing.push({name:n,index})});
      if(!missing.length)return {type:'craft',name,indices:material};
      const copy=()=>new Map([...available].map(([n,a])=>[n,[...a]]));
      return missing.map(({name:n,index})=>{
        const action=this.planFor(n,copy(),next),cost=this.missingCost(n,copy(),next),item=this.items.get(n),focus=this.policy.focus;
        let rank=cost+index*.0001;
        if(this.policy.strategy==='inventory'&&action.type==='generate')rank+=100000;
        if(this.policy.strategy==='space')rank+=action.type==='craft'?-100000-(action.indices.length*100):action.type==='merge'?-10000:0;
        if(focus!=='auto'&&(this.generatorFor(item)===focus||Object.keys(item?.needs??{}).some(c=>focus==='被动'?c.startsWith('dk_a_'):c.startsWith(`dk_${focus.split('_')[1]}_`))))rank-=1000000;
        return {action,rank};
      }).sort((a,b)=>a.rank-b.rank)[0].action;
    }
    if(item.chain&&item.level>1){const prev=this.base.get(`${item.chain}:${item.level-1}`);if(!prev)return {type:'error',message:'缺少低一级物品'};let one=this.planFor(prev,available,next);if(!one.ready)return one;let two=this.planFor(prev,available,next);if(!two.ready)return two;return {type:'merge',a:one.indices[0],b:two.indices[0]}}
    if(item.chain)return {type:'generate',generator:this.generatorFor(item)};
    return {type:'error',message:'这个物品没有可用的生成方式'};
  }
  safeCompact(available){
    // Keep exact recipe ingredients; lower binary tiers may be safely combined toward them.
    const protectedCounts=new Map(),walk=(name,depth=0,quantity=1)=>{if(depth>40)return;protectedCounts.set(name,(protectedCounts.get(name)||0)+quantity);let ing=this.ingredients(name);if(ing?.length)ing.forEach(n=>walk(n,depth+1,quantity))};
    this.demands().forEach(n=>walk(n));
    let pairs=[];
    for(const [name,ids] of available){if(ids.length-Math.min(ids.length,protectedCounts.get(name)||0)>=2&&this.nextName(name))pairs.push({type:'merge',a:ids.at(-2),b:ids.at(-1),reason:'腾出一个空格',extra:true})}
    const neededChains=new Set([...protectedCounts.keys()].map(n=>this.items.get(n)?.chain).filter(Boolean));
    const rank=a=>{const item=this.items.get(this.cells[a.a].name);return (neededChains.has(item.chain)?100:0)+(item.level||0)};
    return pairs.sort((a,b)=>rank(a)-rank(b))[0];
  }
  nextAction(){
    if(this.complete())return {type:'done'};
    if(this.current().error)return {type:'error',message:'当前订单配置需要核对'};
    const {available,missing}=this.reservedStock();
    if(!missing.length)return this.describe({type:'submit',reason:'物品齐了，交付订单'});
    const copyAvailable=()=>new Map([...available].map(([n,a])=>[n,[...a]]));
    const candidates=[...new Set(missing)].map((name,index)=>{
      const action=this.planFor(name,copyAvailable()),cost=this.missingCost(name,copyAvailable());
      const item=this.items.get(name),focus=this.policy.focus;
      const focusMatch=focus!=='auto'&&(this.generatorFor(item)===focus||Object.keys(item?.needs??{}).some(c=>focus==='被动'?c.startsWith('dk_a_'):c.startsWith(`dk_${focus.split('_')[1]}_`)));
      let score=cost+index*.0001;
      if(this.policy.strategy==='inventory')score+=(action.type==='generate'?100000:0);
      if(this.policy.strategy==='space')score+=action.type==='craft'?-100000-(action.indices.length*100):action.type==='merge'?-10000:0;
      if(focusMatch)score-=1000000;
      return {...action,target:name,score,cost,reason:focusMatch?'先做你指定的物品线':STRATEGIES[this.policy.strategy].hint};
    }).sort((a,b)=>a.score-b.score);
    const chosen=candidates.find(a=>a.type!=='error')??candidates[0];
    if(this.policy.strategy==='space'||chosen?.type==='generate'&&this.free()<7){const compact=this.safeCompact(available);if(compact)return this.describe(compact)}
    return this.describe(chosen??{type:'error',message:'没有可执行动作'});
  }
  describe(action){
    const a={...action,seconds:ACTION_SECONDS[action.type]??0},item=this.items.get(action.name);
    if(a.type==='generate'){a.from=this.cells.findIndex(t=>t?.generator===a.generator);a.to=this.cells.findIndex(t=>!t);a.label='生成物品';a.cost=1}
    if(a.type==='merge'){a.from=a.a;a.to=a.b;a.label='合成升级';a.cost=0}
    if(a.type==='craft'){a.from=a.indices?.[0];a.to=a.from;a.label='加工 '+(item?.display??a.name);a.cost=item?.extra??0}
    if(a.type==='submit'){a.from=this.indicesFor(this.demands())?.[0];a.to=a.from;a.label='交付订单';a.cost=0}
    return a;
  }
  execute(action){
    let result;
    switch(action.type){
      case 'generate':result=this.generate(action.generator);break;
      case 'merge':result=this.merge(action.a,action.b);break;
      case 'craft':result=this.craft(action.name,action.indices);break;
      case 'submit':result=this.submit();break;
      case 'done':return this.fail('当天订单全部完成');
      default:return this.fail(action.message||'没有可执行动作');
    }
    if(result.ok){this.elapsed+=action.seconds??0;this.lastAction={...action,step:this.actions,energy:this.energy,elapsed:this.elapsed};result.action=this.lastAction}
    return result;
  }
  step(){return this.execute(this.nextAction())}
}

// One pending timer, one real action per frame. Policy/speed changes never reset the run.
export class RobotPlayer {
  constructor(sim,{onFrame=()=>{},onState=()=>{},setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.sim=sim;this.onFrame=onFrame;this.onState=onState;this.setTimer=setTimer;this.clearTimer=clearTimer;this.speed=1;this.playing=false;this.timer=null;this.generation=0;
  }
  cancel(){this.generation++;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null}
  stop(){this.playing=false;this.cancel();this.onState()}
  start(){if(this.playing||this.sim.complete())return;this.playing=true;this.onState();this.tick()}
  setSpeed(value){if(![.5,1,2,4,8,16,32].includes(value))throw Error('无效速度');this.speed=value;if(this.playing){this.cancel();this.schedule(120)}this.onState()}
  setPolicy(strategy,focus){this.sim.setPolicy(strategy,focus);if(this.playing){this.cancel();this.schedule(30)}this.onState()}
  schedule(ms){const generation=this.generation;this.timer=this.setTimer(()=>{if(generation!==this.generation||!this.playing)return;this.timer=null;this.tick()},Math.max(16,ms))}
  tick(){
    if(!this.playing)return;
    const before=this.sim.cells.map(t=>t?{...t}:null),action=this.sim.nextAction(),result=this.sim.execute(action);
    if(!result.ok||this.sim.complete()){this.playing=false;this.cancel()}
    this.onFrame({action,result,before,duration:Math.max(16,(action.seconds||.8)*1000/this.speed)});
    this.onState();if(this.playing)this.schedule((action.seconds||.8)*1000/this.speed);
  }
  single(){this.stop();const before=this.sim.cells.map(t=>t?{...t}:null),action=this.sim.nextAction(),result=this.sim.execute(action);this.onFrame({action,result,before,duration:450});this.onState();return result}
}
