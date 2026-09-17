// Discrete expected-yield sandbox. Deliberately separate from the production optimizer.
export class MergeSimulator {
  constructor(data,day,{opening='empty'}={}){
    this.data=data;this.day=data.days.find(d=>d.day===day);if(!this.day)throw Error('不存在此day');
    this.items=new Map(data.items.map(i=>[i.name,i]));this.alias=new Map();data.items.forEach(i=>[i.name,i.display,i.key,i.mf].filter(Boolean).forEach(a=>this.alias.set(a,i.name)));
    this.orders=data.orders.filter(o=>o.day===day);this.cells=Array(56).fill(null);this.cursor=0;this.spent=0;this.energy=this.day.target??Math.ceil(this.day.stamina);this.merges=0;this.crafts=0;this.delivered=0;this.actions=0;this.uid=0;this.fractions={};this.clicks={};this.log=[];this.history=[];this.peakOccupancy=8;this.last=[];this.opening=opening;this.failure='';
    for(let i=0;i<7;i++)this.cells[49+i]={generator:`os_${i+1}`};this.cells[48]={generator:'被动'};
    this.base=new Map();data.items.filter(i=>i.chain&&i.level&&i.extra===0&&(!i.store||i.store===this.day.store)).forEach(i=>{const key=`${i.chain}:${i.level}`;if(!this.base.has(key))this.base.set(key,i.name)});
    if(opening==='carry'){
      let prev=data.orders.find(o=>o.row===this.orders[0].row-1);let remain=prev?.remaining??{};
      for(let [chain,value] of Object.entries(remain)){
        if(chain.startsWith('dk_a')&&prev.store!==this.day.store)continue;
        if(!Number.isFinite(value)||value<=0)continue;
        let units=Math.floor(value);this.fractions[chain]=value-units;
        for(let level=16;level>=1;level--){let name=this.base.get(`${chain}:${level}`),size=2**(level-1);if(!name)continue;while(units>=size){if(!this.place(name))throw Error('期初库存超出48个可用格，无法载入；请改用空棋盘');units-=size;}}
        if(units>0)throw Error(`期初库存找不到基础物品：${chain}`);
      }
    }
    this.note(opening==='carry'?'已载入上一单缓存库存，小数进入产出累加器':'空棋盘开局 · 生成器占8格');this.updatePeak();
  }
  current(){return this.orders[this.cursor]}
  complete(){return this.cursor>=this.orders.length}
  stock(){const s={};this.cells.forEach(t=>{if(t?.name)s[t.name]=(s[t.name]||0)+1});return s}
  free(){return this.cells.filter(t=>!t).length}
  snapshot(){return JSON.parse(JSON.stringify({cells:this.cells,cursor:this.cursor,spent:this.spent,energy:this.energy,merges:this.merges,crafts:this.crafts,delivered:this.delivered,actions:this.actions,uid:this.uid,fractions:this.fractions,clicks:this.clicks,log:this.log,peakOccupancy:this.peakOccupancy,last:this.last,failure:this.failure}))}
  checkpoint(){this.history.push(this.snapshot());if(this.history.length>80)this.history.shift()}
  undo(){let s=this.history.pop();if(!s)return false;Object.assign(this,s);return true}
  note(s){this.log.unshift(s);this.log=this.log.slice(0,40)}
  place(name){let i=this.cells.findIndex(t=>!t);if(i<0)return false;this.cells[i]={name,id:++this.uid};this.last.push(i);return true}
  updatePeak(){this.peakOccupancy=Math.max(this.peakOccupancy,56-this.free())}
  canonical(name){return this.alias.get(name)||name}
  ingredients(name){let i=this.items.get(name);if(!i)return null;if(i.recipe)return i.recipe.map(n=>this.canonical(n));if(i.chain&&i.extra>0){let base=this.base.get(`${i.chain}:${i.level}`);return base&&base!==name?[base]:null}return null}
  nextName(name){let item=this.items.get(name);if(!item?.chain||!item.level||item.extra>0)return null;return this.base.get(`${item.chain}:${item.level+1}`)||null}
  actionDone(message){this.actions++;this.failure='';this.note(message);this.updatePeak();return {ok:true,message}}
  fail(message){this.failure=message;return {ok:false,message}}
  generate(generator){
    if(this.complete())return this.fail('当天订单已完成');if(this.energy<1)return this.fail('体力不足，可以在实验控制中补充体力');
    let eff=this.current().eff,outputs=[],next={...this.fractions};
    let chains=Object.keys(eff).filter(k=>generator==='被动'?k.startsWith('dk_a_'):k.startsWith(`dk_${generator.split('_')[1]}_`));
    if(!chains.some(c=>eff[c]>0))return this.fail('该生成器在当前订单尚未启用');
    for(let c of chains){let name=this.base.get(`${c}:1`);if(eff[c]>0&&!name)return this.fail(`未配置 ${c} 的一级物品`);let v=(next[c]||0)+(eff[c]||0),n=Math.floor(v+1e-9);next[c]=v-n;for(let j=0;j<n;j++)outputs.push(name)}
    if(this.free()<outputs.length)return this.fail('棋盘空间不足，请合并或移出物品');
    this.checkpoint();this.last=[];this.fractions=next;outputs.forEach(n=>this.place(n));this.energy--;this.spent++;this.clicks[generator]=(this.clicks[generator]||0)+1;
    return this.actionDone(`${generator==='被动'?'OSA':generator.replace('_','').toUpperCase()} 生成 ${outputs.length} 件 · 消耗1体力`);
  }
  merge(a,b){let x=this.cells[a],y=this.cells[b];if(a===b||!x?.name||x.name!==y?.name)return this.fail('选择两个同名同级物品进行合并');let next=this.nextName(x.name);if(!next)return this.fail('该物品已到配置最高级，或需要加工');this.checkpoint();this.last=[b];this.cells[a]=null;this.cells[b]={name:next,id:++this.uid};this.merges++;return this.actionDone(`合成 ${this.items.get(next)?.display??next}`)}
  move(a,b){if(a===b||!this.cells[a]?.name||this.cells[b]?.generator)return this.fail('生成器固定在原位');if(this.cells[b]?.name===this.cells[a].name&&this.nextName(this.cells[a].name))return this.merge(a,b);this.checkpoint();[this.cells[a],this.cells[b]]=[this.cells[b],this.cells[a]];this.last=[b];return this.actionDone('移动棋子')}
  indicesFor(names){let used=[];for(let name of names){let i=this.cells.findIndex((t,j)=>t?.name===name&&!used.includes(j));if(i<0)return null;used.push(i)}return used}
  canCraft(name){let ing=this.ingredients(name);return ing?.length&&this.indicesFor(ing)!==null}
  craft(name,indices){let item=this.items.get(name),ing=this.ingredients(name);if(!item||!ing?.length)return this.fail('没有可用配方');if(item.error)return this.fail('配方配置待核对，暂不模拟加工');let ids=indices??this.indicesFor(ing);if(!ids||ids.length!==ing.length||new Set(ids).size!==ids.length||ing.some((n,j)=>this.cells[ids[j]]?.name!==n))return this.fail('材料不足');if(this.energy<item.extra)return this.fail('加工所需体力不足');this.checkpoint();ids.forEach(i=>this.cells[i]=null);this.last=[];this.place(name);this.energy-=item.extra;this.spent+=item.extra;this.crafts++;return this.actionDone(`加工完成：${item.display} · ${item.machine||'加工台'}`)}
  demands(){return (this.current()?.lines??[]).flatMap(l=>Array.from({length:l.quantity},()=>l.name))}
  submit(){let o=this.current();if(!o)return this.fail('当天订单已完成');if(o.error)return this.fail('该订单配方拆解待核对');let ids=this.indicesFor(this.demands());if(!ids)return this.fail('请先准备好订单需要的全部物品');this.checkpoint();ids.forEach(i=>this.cells[i]=null);this.last=[];
    if(o.clean){let totals={};this.cells.forEach(t=>{let it=this.items.get(t?.name);if(it?.chain)totals[it.chain]=(totals[it.chain]||0)+it.units});let thresholds=this.data.recycle?.thresholds??{};let candidates=Object.entries(totals).filter(([c,v])=>thresholds[c]!=null&&v>=thresholds[c]).sort((a,b)=>b[1]-a[1]);
      if(candidates.length){let [c,v]=candidates[0],level=Math.floor(Math.log2(v))+1;let tiers=Object.entries(this.data.recycle?.catalog??{}).filter(([k])=>k.startsWith(c+'_'));let exact=tiers.find(([k])=>k===c+'_'+level);if(!exact&&c.startsWith('dk_7_'))exact=tiers.sort((a,b)=>b[1]-a[1])[0];if(exact){let remaining=v-exact[1];this.cells.forEach((t,i)=>{if(this.items.get(t?.name)?.chain===c)this.cells[i]=null});for(let l=16;l>=1;l--){let name=this.base.get(`${c}:${l}`),u=2**(l-1);while(name&&remaining>=u){this.place(name);remaining-=u}}this.note(`clean 回收 ${exact[1]} 个${this.data.chains[c]??c}一级等价量`)}}
    }
    this.cursor++;this.delivered++;return this.actionDone(`已交付订单 ${o.day}-${o.order}${this.complete()?' · 当天全部完成！':''}`)
  }
  refill(){this.checkpoint();this.energy+=100;return this.actionDone('实验补充100体力')}
  remove(index){if(!this.cells[index]?.name)return this.fail('请选择一个物品');this.checkpoint();let name=this.cells[index].name;this.cells[index]=null;this.last=[];return this.actionDone(`移出实验棋盘：${this.items.get(name)?.display??name}`)}
  compactPair(){let stock=this.stock(),wanted={};for(let name of this.demands()){wanted[name]=(wanted[name]||0)+1;let ing=this.ingredients(name);ing?.forEach(n=>wanted[n]=(wanted[n]||0)+1)}for(let [n,count] of Object.entries(stock)){if(count-(wanted[n]||0)>=2&&this.nextName(n)){let ids=this.indicesFor([n,n]);return {type:'merge',a:ids[0],b:ids[1]}}}return null}
  nextAction(){
    if(this.complete())return {type:'done'};if(this.current().error)return {type:'error',message:'当前订单拆解待核对'};
    let stock=this.stock();const ensure=(name,depth=0)=>{
      if(depth>40)return {type:'error',message:'配方层数过深或循环'};
      if(stock[name]>0){stock[name]--;return null}
      let item=this.items.get(name);if(!item||item.error)return {type:'error',message:`${name} 配置待核对`};
      let ing=this.ingredients(name);if(ing?.length){for(let n of ing){let a=ensure(n,depth+1);if(a)return a}return {type:'craft',name}}
      if(item.chain&&item.level>1){let prev=this.base.get(`${item.chain}:${item.level-1}`);if(!prev)return {type:'error',message:'缺少前一级物品'};for(let j=0;j<2;j++){let a=ensure(prev,depth+1);if(a)return a}let ids=this.indicesFor([prev,prev]);return ids?{type:'merge',a:ids[0],b:ids[1]}:{type:'error',message:'合成材料不足'}}
      if(item.chain){let generator=item.chain.includes('_a_')?'被动':`os_${item.chain.split('_')[1]}`;return {type:'generate',generator}}
      return {type:'error',message:`无法生成 ${name}`}
    };
    for(let name of this.demands()){let a=ensure(name);if(a){if(a.type==='generate'&&this.free()<7){let compact=this.compactPair();if(compact)return compact}return a}}
    return {type:'submit'};
  }
  step(){let a=this.nextAction();switch(a.type){case 'done':return this.fail('当天全部订单已完成');case 'error':return this.fail(a.message);case 'generate':return this.generate(a.generator);case 'merge':return this.merge(a.a,a.b);case 'craft':return this.craft(a.name);case 'submit':return this.submit();default:return this.fail('没有可执行动作')}}
}
