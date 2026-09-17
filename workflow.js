import {RobotSimulator} from './robot.js';
const copy=x=>JSON.parse(JSON.stringify(x));
export const PLAN_MODES={value:'金币优先',easy:'易完成优先',random:'随机选单'};
export const MAX_PLAN_ORDERS=7;
export const DEFAULT_PLAN=[{mode:'easy'}];
export function defaultOrders(data,day){return data.orders.filter(o=>o.day===day).map((o,i)=>({...copy(o),id:`sheet-${o.row}`,title:`订单 ${o.day}-${o.order}`,reward:o.clean&&!o.lines.length?0:Math.max(20,Math.round((o.stamina||0)*2+50+i%3*20)),rewardSource:'demo',source:'sheet'}))}
export function validatePlan(plan){if(!Array.isArray(plan)||!plan.length||plan.length>MAX_PLAN_ORDERS)throw Error('计划需要1到7行，每行只完成1个订单');return plan.map(p=>{if(!p||!Object.hasOwn(PLAN_MODES,p.mode)||p.repeat!==undefined&&p.repeat!==1)throw Error('每行请选择一种选单倾向，只完成1个订单');return {mode:p.mode}})}
export function validateOrders(data,day,orders){
  if(!Array.isArray(orders)||!orders.length||orders.length>100)throw Error('订单池需要1到100张订单');
  const items=new Map(data.items.map(i=>[i.name,i])),store=data.days.find(d=>d.day===day)?.store,ids=new Set();
  return orders.map((o,index)=>{
    if(typeof o.id!=='string'||!o.id||ids.has(o.id))throw Error('订单编号重复或缺失');ids.add(o.id);
    if(typeof o.title!=='string'||o.title.length>100)throw Error('订单名称最多100字');
    if(!Number.isInteger(o.reward)||o.reward<0||o.reward>100000000)throw Error('金币奖励请输入0到100000000的整数');
    if(!Array.isArray(o.lines)||o.lines.length>20||!o.lines.length&&!o.clean)throw Error('普通订单至少需要一个物品，最多20种');
    const seen=new Set();const lines=o.lines.map(l=>{const item=items.get(l.name);if(!item||item.error||item.store&&item.store!==store||item.recipeStore&&/^\d+$/.test(item.recipeStore)&&+item.recipeStore>store)throw Error('订单含未解锁或无法模拟的物品');if(!Number.isInteger(l.quantity)||l.quantity<1||l.quantity>99)throw Error('物品数量请输入1到99的整数');if(seen.has(l.name))throw Error('同一物品请合并填写数量');seen.add(l.name);return {name:l.name,quantity:l.quantity}});
    if(!o.eff||Object.values(o.eff).some(n=>!Number.isFinite(n)||n<0||n>100))throw Error('生成效率无效');
    return {id:o.id,title:o.title||`自定义订单 ${index+1}`,day,store,order:index+1,row:o.row??null,lines,reward:o.reward,rewardSource:o.rewardSource==='demo'?'demo':'manual',source:o.source==='sheet'?'sheet':'manual',eff:copy(o.eff),clean:!!o.clean,stamina:o.stamina??null,error:null};
  });
}

export class WorkflowSimulator extends RobotSimulator {
  constructor(data,day,options={}){
    super(data,day,{...options,strategy:'inventory',focus:'auto'});
    // Preserve audited source issues for inspection; strict editor rules apply to overrides.
    this.orders=options.orders?validateOrders(data,day,options.orders):defaultOrders(data,day);
    this.completedIds=[];this.activeId=null;this.plan=validatePlan(options.plan??DEFAULT_PLAN);this.planIndex=0;this.planOrders=[];this.coins=0;this.randomState=(options.seed??20260917)>>>0;
    this.warehouse=Array(options.warehouseCapacity??7).fill(null);this.validateCapacity(this.warehouse.length);
    this.events=[];this.eventSerial=0;this.resumeGenerate=null;this.decision=null;this.history=[];this.failure='';this.log=[];this.note('等待按计划选择订单');
  }
  current(){return this.completedIds?this.orders.find(o=>o.id===this.activeId):super.current()}
  ordersComplete(){return this.completedIds?this.completedIds.length>=this.orders.length:super.complete()}
  planComplete(){return !!this.plan&&this.planIndex>=this.plan.length}
  complete(){return this.ordersComplete()||this.planComplete()}
  pending(){return this.orders.filter(o=>!this.completedIds.includes(o.id))}
  snapshot(){return {...super.snapshot(),completedIds:copy(this.completedIds??[]),activeId:this.activeId??null,planIndex:this.planIndex??0,planOrders:copy(this.planOrders??[]),coins:this.coins??0,randomState:this.randomState??0,warehouse:copy(this.warehouse??[]),eventLength:this.events?.length??0,eventSerial:this.eventSerial??0,resumeGenerate:this.resumeGenerate??null,decision:copy(this.decision??null)}}
  undo(){const saved=this.history.pop();if(!saved)return false;const {eventLength,...state}=saved;Object.assign(this,state);this.events.length=eventLength;return true}
  generate(generator){return this.current()?super.generate(generator):this.fail('先点播放或单步，让机器人按计划选择订单')}
  lockedPlanRows(){return this.planIndex+(this.activeId?1:0)}
  setPlan(plan){const next=validatePlan(plan),locked=this.lockedPlanRows();if(next.length<locked||next.slice(0,locked).some((p,i)=>p.mode!==this.plan[i].mode))throw Error('已完成和正在执行的计划已绑定订单，请修改后续计划；重开后可重新设置全部计划');this.plan=next;this.history=[];this.failure='';this.record('计划修改',`已设置${next.length}行计划`,this.current()?'保留当前订单和已完成记录，后续每行完成1单，全部执行后停止':`已完成${this.planIndex}行；剩余每行只完成1单，全部执行后停止`);return this.plan}
  validateCapacity(n){if(!Number.isInteger(n)||n<0||n>200)throw Error('仓库容量请输入0到200格')}
  resizeWarehouse(n){this.validateCapacity(n);const stock=this.warehouse.filter(Boolean);if(n<stock.length)throw Error(`仓库已有${stock.length}件物品，不能缩到${n}格`);this.checkpoint();this.warehouse=[...stock,...Array(n-stock.length).fill(null)];this.record('仓库设置',`仓库调整为${n}格`,'只改变可用空间，不改变物品或体力');return n}
  allAvailable(includeWarehouse=true){const available=new Map(),add=(t,id)=>{if(t?.name){if(!available.has(t.name))available.set(t.name,[]);available.get(t.name).push(id)}};this.cells.forEach((t,i)=>add(t,i));if(includeWarehouse)this.warehouse.forEach((t,i)=>add(t,-i-1));return available}
  allStock(){const s=this.stock();this.warehouse.forEach(t=>{if(t?.name)s[t.name]=(s[t.name]||0)+1});return s}
  reservedStock(){const available=this.allAvailable(),missing=[];for(const name of this.demands()){const ids=available.get(name);if(ids?.length)ids.shift();else missing.push(name)}return {available,missing}}
  safeCompact(available){return super.safeCompact(new Map([...available].map(([n,ids])=>[n,ids.filter(i=>i>=0)])))}
  estimate(order,useInventory=true){
    if(order.error)return Infinity;
    const inventory=useInventory?this.allAvailable():new Map(),deficits={},trail=new Set();let extra=0;
    const need=(name,quantity,depth=0)=>{if(depth>40||trail.has(name))throw Error('配方层级或循环异常');const ids=inventory.get(name);if(ids?.length){const used=Math.min(quantity,ids.length);ids.splice(0,used);quantity-=used}if(quantity<=0)return;const item=this.items.get(name);if(!item||item.error)throw Error('物品无法拆解');trail.add(name);const ing=this.ingredients(name);if(ing?.length){extra+=(item.extra||0)*quantity;for(const n of ing)need(n,quantity,depth+1)}else if(item.chain&&item.level>1){const prev=this.base.get(`${item.chain}:${item.level-1}`);if(!prev)throw Error('缺少基础等级');need(prev,quantity*2,depth+1)}else if(item.chain)deficits[item.chain]=(deficits[item.chain]||0)+quantity;else throw Error('无生成方式');trail.delete(name)};
    try{order.lines.forEach(l=>need(l.name,l.quantity));const generators={};for(const [chain,quantity] of Object.entries(deficits)){const eff=order.eff[chain]||0,remaining=Math.max(0,quantity-(useInventory?this.fractions[chain]||0:0));if(remaining>0&&eff<=0)return Infinity;const g=chain.includes('_a_')?'被动':`os_${chain.split('_')[1]}`;generators[g]=Math.max(generators[g]||0,Math.ceil(remaining/(eff||1)-1e-9))}return extra+Object.values(generators).reduce((a,b)=>a+b,0)}catch{return Infinity}
  }
  evaluations(){return this.pending().map(o=>{const remaining=this.estimate(o),total=this.estimate(o,false);return {id:o.id,title:o.title,reward:o.reward,rewardSource:o.rewardSource,remaining,progress:Number.isFinite(remaining)&&Number.isFinite(total)?Math.max(0,Math.min(1,total?1-remaining/total:1)):0}})}
  choose(){
    if(this.complete())return {type:'done'};
    const mode=this.plan[this.planIndex]?.mode??'easy',rows=this.evaluations().filter(o=>Number.isFinite(o.remaining));if(!rows.length)return {type:'error',message:'剩余订单无法生成，请在订单编辑中核对需求与生成效率'};
    let chosen,randomState=this.randomState;
    if(mode==='random'){randomState=(Math.imul(1664525,randomState)+1013904223)>>>0;chosen=rows[Math.floor(randomState/4294967296*rows.length)]}
    else chosen=[...rows].sort((a,b)=>mode==='value'?b.reward-a.reward||a.remaining-b.remaining:a.remaining-b.remaining||b.reward-a.reward)[0];
    const reason=mode==='value'?`在${rows.length}张可选订单中，金币奖励${chosen.reward}最高${chosen.rewardSource==='demo'?'（演示值，非表格输入）':''}；预计还需${chosen.remaining}体力`:mode==='easy'?`扣除棋盘和仓库已有物品后，预计还需${chosen.remaining}体力，为当前最少；奖励${chosen.reward}金币${chosen.rewardSource==='demo'?'（演示值）':''}`:`从${rows.length}张可选订单中等概率抽取；随机序列可通过撤销重现`;
    return {type:'select',orderId:chosen.id,mode,randomState,reason,label:`选择 ${chosen.title}`,seconds:0,cost:0,evaluation:chosen};
  }
  nextAction(){
    if(this.complete())return {type:'done'};if(!this.current())return this.choose();
    if(this.resumeGenerate){const generator=this.resumeGenerate;if(this.free()>=this.outputCount(generator))return this.describe({type:'generate',generator,reason:'空间已腾出，继续刚才的生成'});return this.makeRoom(this.outputCount(generator),generator)}
    const action=super.nextAction();
    if(action.type==='submit'&&!this.indicesFor(this.demands())){const available=this.allAvailable(),needed=[];for(const n of this.demands()){let id=available.get(n)?.shift();if(id<0)needed.push(-id-1)}if(needed.length)return this.retrievePlan(needed[0],'订单物品已齐，从仓库取回后交付')}
    const ids=action.type==='merge'?[action.a,action.b]:action.type==='craft'?action.indices??[]:[];
    const stored=ids.find(i=>i<0);if(stored!==undefined)return this.retrievePlan(-stored-1,'需要这件仓库材料来合成或加工当前订单');
    if(action.type==='generate'&&this.free()<this.outputCount(action.generator))return this.makeRoom(this.outputCount(action.generator),action.generator);
    if(action.type==='merge'&&action.extra)action.reason=`棋盘只剩${this.free()}格，先自动合并不影响订单的同级物品，释放1格`;
    if(!action.reason||!action.extra){const order=this.current();action.reason=action.type==='submit'?`当前订单${order.title}的需求已全部在棋盘上，交付并推进计划`:action.type==='generate'?`为${order.title}补充缺少的材料，当前库存不足；每次生成扣1体力`:action.type==='merge'?`把两件同级材料合成更高一级，继续准备${order.title}，不消耗体力`:action.type==='craft'?`材料已经齐全，按配方加工${this.items.get(action.name)?.display??action.name}`:action.reason}
    return action;
  }
  outputCount(generator){const eff=this.current()?.eff??{};return Object.entries(eff).filter(([c])=>generator==='被动'?c.startsWith('dk_a_'):c.startsWith(`dk_${generator.split('_')[1]}_`)).reduce((n,[c,e])=>n+Math.floor((this.fractions[c]||0)+e+1e-9),0)}
  stashCandidate(){const wanted=new Set(this.demands()),chains=new Set(this.demands().flatMap(n=>{const i=this.items.get(n);return [i?.chain,...Object.keys(i?.needs??{})]}).filter(Boolean));return this.cells.map((t,i)=>({t,i,item:this.items.get(t?.name)})).filter(x=>x.item).sort((a,b)=>(wanted.has(a.t.name)?1000:chains.has(a.item.chain)?100:0)-(wanted.has(b.t.name)?1000:chains.has(b.item.chain)?100:0)||(b.item.level||0)-(a.item.level||0))[0]?.i}
  makeRoom(required,generator){
    const compact=this.safeCompact(this.reservedStock().available);if(compact)return {...this.describe(compact),reason:`本次生成需要${required}格，棋盘只剩${this.free()}格；自动合并两件同级物品，释放1格`};
    const index=this.stashCandidate();if(this.warehouse.some(t=>!t)&&index!==undefined)return {type:'store',index,from:index,to:index,resume:generator,seconds:.4,cost:0,label:'移入仓库',reason:`本次生成需要${required}格，棋盘只剩${this.free()}格且没有安全合并；暂存物品到仓库，不丢弃`};
    return {type:'error',message:`棋盘剩${this.free()}格，本次需要${required}格；仓库已满且没有安全合并。请增加仓库容量或手动整理，不会自动删除物品`};
  }
  retrievePlan(index,reason){let to=this.cells.findIndex(t=>!t);if(to<0){const compact=this.safeCompact(this.reservedStock().available);if(compact)return {...this.describe(compact),reason:'棋盘已满，先合并释放一格，再取回仓库材料'};to=this.stashCandidate()}return {type:'retrieve',index,to,seconds:.4,cost:0,label:'取回仓库物品',reason:reason+(this.cells[to]?.name?'；棋盘已满，与一件暂不优先使用的物品换位':'')};}
  record(kind,label,reason){if(!this.events)return;this.events.push({serial:++this.eventSerial,kind,label,reason,step:this.actions,completed:this.delivered,elapsed:this.elapsed,energy:this.energy,coins:this.coins,order:this.current()?.title??null})}
  submit(){const order=this.current();if(!order)return this.fail('请先按计划选择一张订单');const result=super.submit();if(result.ok){this.completedIds.push(order.id);this.coins+=order.reward;this.activeId=null;this.resumeGenerate=null;this.planIndex++;this.cursor=this.completedIds.length}return result}
  execute(action){
    if(action.type==='done')return {ok:false,message:this.ordersComplete()?'当天全部订单已交付':'已执行完设置的计划，机器人已停止'};
    if(action.type==='select'){
      if(this.complete()||this.current()||this.completedIds.includes(action.orderId)||!this.orders.some(o=>o.id===action.orderId))return this.fail('订单选择已失效');
      this.checkpoint();this.activeId=action.orderId;this.planOrders[this.planIndex]=action.orderId;this.randomState=action.randomState;this.decision={...copy(action),round:this.planIndex+1};this.lastAction={...action,step:this.actions};this.failure='';this.record('选单',`计划${this.planIndex+1}：${action.label}`,action.reason+'；本行只完成这张订单，交付后推进下一行');return {ok:true,action:this.lastAction};
    }
    if(action.type==='store'||action.type==='retrieve'){
      if(action.type==='store'&&(!this.cells[action.index]?.name||!this.warehouse.some(t=>!t)))return this.fail('无法存入：物品不存在或仓库已满');
      if(action.type==='retrieve'&&(!this.warehouse[action.index]?.name||!Number.isInteger(action.to)||action.to<0||action.to>=48))return this.fail('仓库物品或目标格不可用');
      this.checkpoint();this.last=[];let name;
      if(action.type==='store'){name=this.cells[action.index].name;this.warehouse[this.warehouse.findIndex(t=>!t)]=this.cells[action.index];this.cells[action.index]=null;this.resumeGenerate=action.resume??null}
      else{name=this.warehouse[action.index].name;[this.warehouse[action.index],this.cells[action.to]]=[this.cells[action.to],this.warehouse[action.index]];this.last=[action.to]}
      const message=`${action.type==='store'?'存入':'取回'} ${this.items.get(name)?.display??name}`;this.actionDone(message);this.elapsed+=.4;this.lastAction={...action,label:message,step:this.actions};this.record('仓库',message,action.reason||'手动整理，不消耗体力');return {ok:true,action:this.lastAction};
    }
    const order=this.current(),result=super.execute(action);if(result.ok){if(action.type==='generate')this.resumeGenerate=null;this.record(action.type==='submit'?'交付':'操作',action.type==='submit'?`交付 ${order.title}，获得${order.reward}金币${order.rewardSource==='demo'?'（演示值）':''}`:this.lastAction.label,action.reason||'执行当前订单的合法操作');if(action.type==='submit'&&this.complete())this.record('自动停止',this.ordersComplete()?'当日订单已全部交付':'设置的计划已全部完成',this.ordersComplete()?`已交付全部${this.orders.length}单，没有剩余订单`:`${this.plan.length}行计划各完成1单；订单池还有${this.pending().length}单，未设置计划的订单不会继续执行`)}else this.record('暂停',result.message,action.reason||'没有可执行的安全动作');return result;
  }
}
