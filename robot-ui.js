import {D,state,$,OS,COLORS,NAMES,ICONS,byName,byDay,fmt,esc,ds,glyph,toast,render,renderContent,itemDetail} from './app.js';
import {RobotPlayer,STRATEGIES} from './robot.js';
import {WorkflowSimulator as RobotSimulator,PLAN_MODES} from './workflow.js';
import {help} from './explain.js';
import {loadScenario,workflowPanel,paintWorkflow,warehousePanel,paintWarehouse,orderPool,bindPool,settingsPanel,bindWorkflow,cdTimeLabel} from './workflow-ui.js';

let sim=null,player=null,selected=-1,opening='empty',speed=1,policy='orders',focus='auto';
let initialLayout=null,initialEnergy=0,editing=false,draft=null,draftEnergy=0,brush=null,erase=false;
let paletteQuery='',paletteType='all',paletteOS='all',palettePage=1;
const sessionOpenings=new Map();
const storageKey=store=>`merge-lab-opening-v2:${store}`;
const osLabel=k=>k==='被动'?'礼盒':NAMES[OS.indexOf(k)]??k;
const clock=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const savedOpening=()=>{const store=byDay.get(state.day).store;if(sessionOpenings.has(store))return sessionOpenings.get(store);try{const x=JSON.parse(localStorage.getItem(storageKey(store))||'null');return x?.version===2?x:null}catch{return null}};
const colorFor=item=>{let chain=item?.chain??Object.keys(item?.needs??{})[0]??'';return COLORS[chain.includes('_a_')?7:Number(chain.split('_')[1])-1]??'#8496b5'};
export const getSimulation=()=>sim;
export function stopRobot(){player?.stop()}
export function resetRobot(){
  stopRobot();editing=false;selected=-1;
  let options={...loadScenario(),opening:opening==='carry'?'carry':'empty',strategy:policy,focus};
  if(opening==='custom'){const saved=savedOpening();if(saved){options.layout=saved.layout;options.energy=saved.energy}else opening='empty'}
  try{sim=new RobotSimulator(D,state.day,options)}catch(e){opening='empty';sim=new RobotSimulator(D,state.day,{strategy:policy,focus});toast(e.message)}
  initialLayout=sim.exportLayout();initialEnergy=sim.energy;
  player=new RobotPlayer(sim,{onFrame:frame=>{paint();if(frame.result.ok)animate(frame);else toast(frame.result.message)},onState:paintStatus});player.setSpeed(speed);
}
export function changeRobotPolicy(strategy,preferred='auto'){policy=strategy;focus=preferred;player?.setPolicy(strategy,preferred);paintStatus();return sim?.policy}
export function renderBoard(){
  if(!sim||sim.day.day!==state.day)resetRobot();
  $('#content').innerHTML=`<div class="robot-lab ${editing?'editing':''}"><div class="robot-top"><h1>🤖 机器人游乐场</h1><div class="robot-top-actions"><label>日期<select id="robot-day" aria-label="模拟日期">${ds().map(d=>`<option value="${d.day}" ${d.day===state.day?'selected':''}>第 ${d.day} 天</option>`).join('')}</select></label><button id="edit-opening">${editing?'取消布置':'▦ 布置初始棋盘'}</button><button class="small ghost" id="robot-help" aria-label="查看模拟规则">ⓘ</button></div></div><div class="robot-layout"><section class="robot-stage"><div class="robot-stage-head"><div class="robot-state"><span class="robot-avatar">${editing?'🧩':'🤖'}</span><div><strong id="robot-status"></strong><small id="robot-current-action"></small></div></div><div id="energy-pill" class="robot-energy">ϟ <b id="robot-energy"></b><small>体力</small>${help('energy')}</div></div>${editing?'<div class="editor-notice"><span>选物品 → 点格子放入</span><b id="editor-count"></b></div>':''}<div class="board-surface"><div class="board-grid" id="robot-grid" role="group" aria-label="7列8行合成棋盘">${Array.from({length:56},(_,i)=>`<button class="tile" data-robot-cell="${i}" aria-label="第${Math.floor(i/7)+1}行第${i%7+1}列"></button>`).join('')}</div><div class="robot-pointer" id="robot-pointer" aria-hidden="true">🤖<span></span></div></div>${editing?`<div class="editor-save"><button id="opening-cancel">取消</button><button class="primary" id="opening-apply">保存并从这里开始</button></div>`:`<div class="robot-player"><button class="icon-button" id="robot-reset" aria-label="从初始棋盘重新开始" title="重新开始">↺</button><button class="primary play" id="robot-play">▶ 机器人开玩</button><button class="icon-button" id="robot-step" aria-label="执行一步" title="执行一步">▷|</button><button class="icon-button" id="robot-undo" aria-label="撤销一步" title="撤销一步">↶</button></div><div class="robot-speed" role="group" aria-label="播放速度">${[.5,1,2,4,8,16,32].map(n=>`<button data-robot-speed="${n}" class="${n===speed?'active':''}" aria-pressed="${n===speed}">${n}×</button>`).join('')}${help('speed')}</div>`}<div class="robot-caption"><span>${editing?'拖动可换位置；底部生成器固定':'7 × 8 · 合成免费，生成和加工扣体力'}</span><button id="robot-rule-link">规则 ⓘ</button></div><div class="robot-selection" id="robot-selection"></div>${editing?'':warehousePanel()+`<div class="workflow-log-panel"><div class="workflow-log-head"><h2>行为与原因 ${help('log')}</h2><button class="small" id="full-workflow-log">完整日志</button></div><div id="workflow-event-list" class="workflow-event-list"></div></div>`}</section><aside class="robot-side">${editing?editorPanel():`${workflowPanel(sim)}<section class="panel orders-panel"><div class="panel-head"><h2>订单池 ${help('pool')}</h2><b class="live-label" id="robot-progress"></b></div><div class="panel-body" id="robot-orders"></div></section><section class="panel monitor-panel"><div class="panel-head"><h2>这一局</h2><button class="small" id="robot-refill" title="手动补充100体力">⚡ +100</button></div><div class="panel-body"><div class="robot-monitor" id="robot-monitor"></div><div class="energy-caption"><span>剩余体力 ${help('remainingEnergy')}</span><span id="robot-time"></span></div><div id="robot-energy-chart"></div><div class="time-breakdown"><span>CD等待 ${help('cdWait')}</span><span id="robot-cd-time"></span></div><div class="energy-caption"><span>棋盘空间 ${help('boardSpace')}</span><span id="robot-space-count"></span></div><div class="space-meter" id="robot-space"></div><div class="robot-event" id="robot-event" role="status" aria-live="off"></div><details><summary>操作记录与手动加工</summary><div id="robot-log" class="robot-log"></div><div id="robot-craft" class="robot-manual"></div></details></div></section><section class="panel"><div class="panel-body" style="padding-top:16px"><label class="focus-row" style="margin-top:0">开局<select id="robot-opening" aria-label="初始棋盘来源"><option value="empty" ${opening==='empty'?'selected':''}>空棋盘</option><option value="carry" ${opening==='carry'?'selected':''}>带入上一单库存</option><option value="custom" ${opening==='custom'?'selected':''} ${savedOpening()?'':'disabled'}>我保存的棋盘</option></select></label></div></section>${settingsPanel()}`}</aside></div></div>`;
  bind();paint();if(editing)paintPalette();else bindWorkflow({sim,stop:stopRobot,paint,restart:imported=>{if(imported){const saved={version:2,store:sim.day.store,layout:imported.layout,energy:imported.energy};sessionOpenings.set(sim.day.store,saved);try{localStorage.setItem(storageKey(sim.day.store),JSON.stringify(saved))}catch{}opening='custom'}resetRobot();renderBoard()},initial:()=>({layout:[...initialLayout],energy:initialEnergy})});
}
function paintStatus(){
  if(state.page!=='board'||!$('#robot-status')||!sim)return;
  $('#robot-status').textContent=editing?'布置初始棋盘':sim.complete()?'今天的订单完成了':player?.playing?'机器人正在玩':sim.failure?'机器人暂停了':'准备好了';
  $('#robot-current-action').textContent=editing?'保存后开始一局新模拟':`已完成${sim.delivered}次行动 · ${sim.actions}个操作步骤`;
  $('#robot-energy').textContent=fmt(editing?draftEnergy:sim.energy);
  $('#energy-pill').classList.toggle('low',!editing&&sim.energy<10);
  if($('#robot-play')){$('#robot-play').textContent=player?.playing?'Ⅱ 暂停':sim.complete()?'✓ 全部完成':'▶ 机器人开玩';$('#robot-play').disabled=sim.complete();$('#robot-undo').disabled=!sim.history.length}
  document.querySelectorAll('[data-strategy]').forEach(b=>{const active=b.dataset.strategy===policy;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
  document.querySelectorAll('[data-robot-speed]').forEach(b=>{const active=+b.dataset.robotSpeed===speed;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
  if($('#strategy-reason'))$('#strategy-reason').textContent=STRATEGIES[policy].hint;
  if($('#robot-focus'))$('#robot-focus').value=focus;
  if(!player?.playing&&$('#robot-pointer'))$('#robot-pointer').classList.remove('active');
}
function paint(){
  if(state.page!=='board'||!$('#robot-grid'))return;
  const cells=editing?sim.cells.map((t,i)=>i<48?draft[i]?{name:draft[i]}:null:t):sim.cells;
  document.querySelectorAll('[data-robot-cell]').forEach(b=>{
    const i=+b.dataset.robotCell,t=cells[i],item=byName.get(t?.name),g=t?.generator,gi=OS.indexOf(g),key=g??t?.name??'';
    if(b.dataset.content!==key){
      b.dataset.content=key;b.innerHTML=g?`<span class="tile-emoji">${ICONS[gi]}</span><span class="gen-label">${gi===7?'礼盒':`OS${gi+1}`}</span><span class="tile-bolt">ϟ</span>`:item?`<span class="tile-emoji">${glyph(item)}</span><span class="tile-level">${item.level?'L'+item.level:'✦'}</span>`:'<span class="empty-plus">·</span>';
      b.style.setProperty('--tile-color',g?COLORS[gi]:colorFor(item));
      const name=g?osLabel(g)+'生成器':item?.display??'空位';b.title=name;b.setAttribute('aria-label',`${name}，${Math.floor(i/7)+1}行${i%7+1}列`);
    }
    b.classList.toggle('filled',!!t);b.classList.toggle('generator',!!g);b.classList.toggle('selected',!editing&&i===selected);b.draggable=!!item;
  });
  paintStatus();
  if(editing){$('#editor-count').textContent=`${draft.filter(Boolean).length} / 48` ;$('#robot-selection').textContent=erase?'橡皮擦：点物品移除':brush?`已选：${byName.get(brush)?.display??brush}`:'从右侧选择要放入的物品';return}
  paintOrders();paintMonitor();paintSelection();paintWorkflow(sim);paintWarehouse(sim,manual);
}
function paintOrders(){
  $('#robot-progress').textContent=`${sim.delivered} / ${sim.orders.length}`;
  $('#robot-orders').innerHTML=orderPool(sim,manual);bindPool(sim);
  if($('#robot-submit'))$('#robot-submit').onclick=()=>manual(()=>sim.execute(sim.describe({type:'submit',reason:'手动交付已经准备好的订单'})));
  if($('#robot-next-day'))$('#robot-next-day').onclick=()=>{const next=D.days.find(d=>d.day>state.day);if(!next){toast('已经是最后一天');return}state.day=next.day;state.store=next.store;const days=D.days.filter(d=>d.store===next.store);state.from=days[0].day;state.to=days.at(-1).day;resetRobot();render()};
}

function paintMonitor(){
  $('#robot-monitor').innerHTML=`<div><b>${fmt(sim.spent)}</b><small>消耗体力 ${help('spentEnergy')}</small></div><div><b>${sim.actions}</b><small>操作步数 ${help('step')}</small></div><div><b>${sim.merges}</b><small>合成次数 ${help('mergeCount')}</small></div>`;
  $('#robot-time').innerHTML=`操作用时 ${help('time')} ${clock(sim.elapsed)}`;$('#robot-cd-time').textContent=cdTimeLabel();
  const trace=sim.energyTrace,points=trace.filter((_,i)=>i===0||i===trace.length-1||i%Math.max(1,Math.floor(trace.length/150))===0),max=Math.max(1,sim.initialEnergy,...points.map(p=>p.value)),last=Math.max(1,sim.actions),xy=p=>`${4+p.step/last*312},${58-p.value/max*50}`;
  $('#robot-energy-chart').innerHTML=`<svg class="energy-chart" viewBox="0 0 320 66" role="img" aria-label="剩余体力随操作步数变化"><defs><linearGradient id="energy-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#6a8bec" stop-opacity=".25"/><stop offset="1" stop-color="#6a8bec" stop-opacity=".02"/></linearGradient></defs><path d="M4,60 L${points.map(xy).join(' L')} L${4+points.at(-1).step/last*312},60 Z" fill="url(#energy-fill)"/><path d="M${points.map(xy).join(' L')}" fill="none" stroke="#6587ed" stroke-width="2.5"/>${points.map((p,i)=>`<g data-trace-step="${p.step}" tabindex="0" role="button" aria-label="步骤${p.step}，剩余${p.value}体力"><rect x="${Math.max(0,4+p.step/last*312-312/points.length/2)}" y="0" width="${Math.max(3,312/points.length)}" height="66" fill="transparent"/><circle cx="${4+p.step/last*312}" cy="${58-p.value/max*50}" r="2" opacity=".3" fill="#6587ed"/><title>步骤${p.step} · 剩余${p.value}体力 · 点击看原因</title></g>`).join('')}</svg>`;document.querySelectorAll('[data-trace-step]').forEach(b=>{b.onclick=()=>showTrace(+b.dataset.traceStep);b.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();b.onclick()}}});
  const occupied=48-sim.free();$('#robot-space-count').textContent=`${occupied} / 48 格`;
  $('#robot-space').innerHTML=Array.from({length:48},(_,i)=>`<i style="background:${i<occupied?occupied>40?'#eaa260':'#89a1ee':'#edf1f7'}"></i>`).join('');
  const event=$('#robot-event');event.textContent=sim.failure?sim.energy<1?'体力用完了，补充后继续':sim.failure:sim.lastAction?`${({select:'🎯',generate:'⚡',merge:'🧩',craft:'🛠',submit:'📦',store:'📥',retrieve:'📤'})[sim.lastAction.type]} ${sim.lastAction.label}${sim.lastAction.cost?' · −'+fmt(sim.lastAction.cost)+' 体力':''}`:sim.actions?sim.log[0]:'点播放，看机器人完成这一局';event.classList.toggle('error',!!sim.failure);
  $('#robot-log').innerHTML=sim.log.slice(0,12).map(s=>`<p>${esc(s)}</p>`).join('');paintWorkflowLog();
  // Calculate manual recipes only when the user has opened this panel.
  if($('#robot-craft')?.closest('details')?.open)paintCraft();
}
function eventHtml(events){return events.map(e=>`<div class="workflow-event"><div><span class="event-kind">${esc(e.kind)}</span><b>${esc(e.label)}</b><span class="event-meta">步骤${e.step} · ${clock(e.elapsed)}</span></div><p>${esc(e.reason)}</p><div class="event-values"><span>剩余 ${fmt(e.energy)} 体力</span><span>累计 ${fmt(e.coins)} 金币</span><span>已交 ${e.completed} 单</span></div></div>`).join('')}
function showTrace(step){stopRobot();const point=sim.energyTrace.find(p=>p.step===step),events=sim.events.filter(e=>e.step===step);$('#detail-body').innerHTML=`<h2>步骤 ${step} ${help('step',`步骤 ${step}`)}</h2><div class="trace-summary"><span>剩余体力 ${help('remainingEnergy')} <b>${fmt(point?.value)}</b></span></div>${eventHtml(events)||'<p class="workflow-frequency">这是本局的初始体力。</p>'}`;if(!$('#detail').open)$('#detail').showModal()}
function paintWorkflowLog(){if(!$('#workflow-event-list'))return;$('#workflow-event-list').innerHTML=eventHtml(sim.events.slice(-8).reverse())||'<p class="workflow-frequency">点播放，先按计划挑选一张订单。</p>';$('#full-workflow-log').onclick=()=>{$('#detail-body').innerHTML=`<h2>行为与原因 ${help('log')}</h2><p class="workflow-frequency">共${sim.events.length}条；最近的记录在前。</p><button id="export-workflow-log">导出完整日志</button><div class="workflow-event-list" style="max-height:65vh">${eventHtml(sim.events.slice(-300).reverse())}</div><p class="workflow-frequency">窗口展示最近300条，导出包含本局全部记录。</p>`;$('#export-workflow-log').onclick=()=>{const blob=new Blob([JSON.stringify(sim.events,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`robot-log-day-${state.day}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};if(!$('#detail').open)$('#detail').showModal()}}
function paintCraft(){const craftable=D.items.filter(i=>!i.error&&sim.canCraft(i.name));$('#robot-craft').innerHTML=craftable.length?`<select id="robot-craft-choice" aria-label="可加工物品">${craftable.slice(0,60).map(i=>`<option value="${esc(i.name)}">${esc(i.display)}</option>`).join('')}</select><button id="robot-craft-go">加工</button>`:'暂时没有齐全的材料';if($('#robot-craft-go'))$('#robot-craft-go').onclick=()=>manual(()=>sim.craft($('#robot-craft-choice').value))}
function paintSelection(){let item=byName.get(sim.cells[selected]?.name);$('#robot-selection').innerHTML=item?`<span>${glyph(item)} ${esc(item.display)}</span><button id="selected-detail">配方</button><button id="selected-store">放入仓库</button><button id="selected-remove">删除物品</button>`:'也可以自己点击生成、拖动合成';if(item){$('#selected-detail').onclick=()=>itemDetail(item.name);$('#selected-store').onclick=()=>manual(()=>sim.execute({type:'store',index:selected,seconds:.4,reason:'手动把棋盘物品暂存到仓库'}));$('#selected-remove').onclick=()=>manual(()=>sim.remove(selected))}}
function animate({action,before,duration}){
  const surface=$('.board-surface');if(!surface)return;
  surface.querySelectorAll('.flight').forEach(e=>e.remove());surface.querySelectorAll('.robot-target,.arrived').forEach(e=>e.classList.remove('robot-target','arrived'));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,motion=Math.max(45,Math.min(650,duration*.8));$('.robot-lab').style.setProperty('--motion',`${motion}ms`);
  const point=i=>{const cell=$(`[data-robot-cell="${i}"]`);if(!cell)return null;const r=cell.getBoundingClientRect(),p=surface.getBoundingClientRect();return {x:r.left-p.left+r.width/2,y:r.top-p.top+r.height/2}};
  const destination=Number.isInteger(action.to)&&action.to>=0?action.to:sim.last[0],end=point(destination),pointer=$('#robot-pointer');
  if(end){pointer.classList.add('active');pointer.style.left=`${end.x}px`;pointer.style.top=`${end.y}px`;const tile=$(`[data-robot-cell="${destination}"]`);tile.classList.add('robot-target','arrived')}
  if(!reduced&&motion>=55&&['merge','craft','submit'].includes(action.type)){
    const sources=action.type==='merge'?[action.a]:action.type==='craft'?action.indices??[]:before.map((t,i)=>t?.name&&!sim.cells[i]?i:null).filter(i=>i!==null);
    for(const index of sources){const from=point(index),to=action.type==='submit'?{x:surface.clientWidth+30,y:25}:end,item=byName.get(before[index]?.name);if(!from||!to||!item)continue;const ghost=document.createElement('span');ghost.className='flight';ghost.textContent=glyph(item);ghost.style.left=`${from.x}px`;ghost.style.top=`${from.y}px`;surface.append(ghost);const animation=ghost.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:`translate(calc(-50% + ${to.x-from.x}px),calc(-50% + ${to.y-from.y}px)) scale(.65)`,opacity:.1}],{duration:motion,easing:'cubic-bezier(.22,.8,.35,1)'});animation.onfinish=()=>ghost.remove();}
  }
}
function manual(fn){stopRobot();const length=sim.events.length;const r=fn();if(r?.ok===false)toast(r.message);else if(sim.events.length===length&&r?.ok)sim.record('手动',sim.log[0]??'手动操作','由用户操作，不改变选单倾向');selected=-1;paint()}
function showRules(){
  $('#detail-body').innerHTML=`<h2>棋盘怎么玩</h2><div class="model-help"><p>⚡ 生成一次扣1体力；同级合成免费；加工按配置扣体力。体力用完暂停，补充按钮每次加100。</p><p>📦 从当日订单池按计划挑订单。每交付一单推进计划；可优先金币、优先预计剩余体力最少，或随机选单。</p><p>▶ 1×按生成0.8秒、合成0.65秒、加工1.1秒、交付1.2秒播放。速度只影响观看，计时使用这套演示节拍。</p><p>当前使用配置效率的期望产出，尚未接入随机掉落和自然恢复；CD设置为预留，当前不执行等待。礼盒可手动生成，回收规则也作了棋盘化处理，因此体力可能与表格连续计算不同。</p><p>初始布局只保存在当前浏览器；保存布局会开始一局新模拟。原始配置不变。</p><p>仓库默认7格，空间不足时先合并，再暂存，不自动删除。金币是演示值或手动值，不来自工作簿。</p></div>`;$('#detail').showModal();
}
function editorPanel(){return `<section class="panel editor-panel"><div class="panel-head"><h2>选择初始物品</h2><span class="live-label">仅保存到本机</span></div><div class="panel-body"><div class="editor-tools"><label>初始体力 <input id="opening-energy" type="number" min="0" max="1000000" step="1" value="${draftEnergy}" aria-label="初始体力"></label><button id="opening-eraser" class="${erase?'selected':''}">⌫ 擦除</button></div><div class="editor-selected" id="editor-selected"></div><input class="palette-search" id="palette-search" type="search" placeholder="搜索物品或名称" aria-label="搜索初始物品" value="${esc(paletteQuery)}"><div class="palette-filter"><select id="palette-os" aria-label="初始物品线"><option value="all">全部物品线</option>${OS.map((k,i)=>`<option value="${i===7?'a':i+1}" ${paletteOS===String(i===7?'a':i+1)?'selected':''}>${ICONS[i]} ${osLabel(k)}</option>`).join('')}</select><select id="palette-type" aria-label="初始物品类型"><option value="all">全部类型</option><option value="base" ${paletteType==='base'?'selected':''}>合成物品</option><option value="recipe" ${paletteType==='recipe'?'selected':''}>加工物品</option></select></div><div class="item-palette" id="item-palette"></div><div class="palette-pagination"><button id="palette-prev" class="small">←</button><span id="palette-count"></span><button id="palette-next" class="small">→</button></div><div class="editor-hint">同一物品可连续放入多个格子</div><div class="editor-tools"><button id="opening-clear" class="small">清空物品</button><button id="opening-current" class="small">复制正在玩的棋盘</button>${savedOpening()?'<button id="opening-load" class="small">载入已保存布局</button>':''}</div></div></section>`}
function paletteItems(){return D.items.filter(i=>!i.error&&(!i.store||i.store===sim.day.store)&&(!i.recipeStore||!/^\d+$/.test(i.recipeStore)||+i.recipeStore<=sim.day.store)&&(paletteType==='all'||paletteType==='base'&&i.chain&&!i.recipe||paletteType==='recipe'&&(i.recipe||i.extra>0))&&(paletteOS==='all'||i.chain?.startsWith(`dk_${paletteOS}_`)||Object.keys(i.needs??{}).some(c=>c.startsWith(`dk_${paletteOS}_`)))&&(!paletteQuery||`${i.display} ${i.name}`.toLowerCase().includes(paletteQuery.toLowerCase())))}
function paintPalette(){
  if(!editing||!$('#item-palette'))return;
  const items=paletteItems(),pages=Math.max(1,Math.ceil(items.length/24));palettePage=Math.min(palettePage,pages);
  $('#item-palette').innerHTML=items.slice((palettePage-1)*24,palettePage*24).map(i=>`<button class="palette-item ${i.name===brush&&!erase?'active':''}" data-palette-item="${esc(i.name)}" draggable="true" title="${esc(i.display)}"><span class="glyph">${glyph(i)}</span><span class="name">${esc(i.display)}</span><span class="level">${i.level?'等级 '+i.level:'加工物品'}</span></button>`).join('')||'<div class="empty">没有匹配物品</div>';
  $('#palette-count').textContent=`${palettePage} / ${pages} · ${items.length} 件`;$('#palette-prev').disabled=palettePage===1;$('#palette-next').disabled=palettePage===pages;
  $('#editor-selected').innerHTML=erase?'<span>⌫</span><span>擦除棋盘上的物品</span>':brush?`<span>${glyph(byName.get(brush))}</span><span>${esc(byName.get(brush)?.display??brush)}</span>`:'<span>👆</span><span>先选一个物品</span>';
  document.querySelectorAll('[data-palette-item]').forEach(b=>{b.onclick=()=>{brush=b.dataset.paletteItem;erase=false;$('#opening-eraser').classList.remove('selected');paintPalette();paint()};b.ondragstart=e=>{e.dataTransfer.setData('application/x-merge-item',b.dataset.paletteItem);e.dataTransfer.effectAllowed='copy'}});
}
function openEditor(){stopRobot();editing=true;draft=[...initialLayout];draftEnergy=initialEnergy;selected=-1;renderBoard()}
function applyEditor(){
  const value=Number($('#opening-energy').value);try{sim.validateOpening(draft,value)}catch(e){toast(e.message);return}
  const saved={version:2,store:sim.day.store,layout:[...draft],energy:value};sessionOpenings.set(sim.day.store,saved);let stored=true;try{localStorage.setItem(storageKey(sim.day.store),JSON.stringify(saved))}catch{stored=false}
  stopRobot();sim=new RobotSimulator(D,state.day,{...loadScenario(),layout:draft,energy:value});initialLayout=sim.exportLayout();initialEnergy=sim.energy;opening='custom';editing=false;
  player=new RobotPlayer(sim,{onFrame:frame=>{paint();if(frame.result.ok)animate(frame);else toast(frame.result.message)},onState:paintStatus});player.setSpeed(speed);renderBoard();toast(stored?'初始棋盘已保存，开始吧':'已应用这次布局；当前浏览器未允许保存');
}
function bind(){
  $('#robot-day').onchange=e=>{state.day=+e.target.value;resetRobot();renderContent()};$('#edit-opening').onclick=()=>{if(editing){editing=false;renderBoard()}else openEditor()};$('#robot-help').onclick=showRules;$('#robot-rule-link').onclick=showRules;
  document.querySelectorAll('[data-robot-cell]').forEach(b=>{const i=+b.dataset.robotCell;
    b.onclick=()=>{if(editing){if(i>=48)return;if(erase)draft[i]=null;else if(brush)draft[i]=brush;else{toast('先从右侧选一个物品');return}paint();return}const t=sim.cells[i];if(t?.generator){manual(()=>sim.generate(t.generator));return}if(selected>=0&&selected!==i){manual(()=>sim.move(selected,i));return}selected=selected===i?-1:i;paintSelection();paint()};
    b.ondragstart=e=>{if(!editing)stopRobot();e.dataTransfer.setData('application/x-merge-cell',String(i));e.dataTransfer.effectAllowed='move'};b.ondragover=e=>{if(i<48)e.preventDefault()};
    b.ondrop=e=>{e.preventDefault();if(i>=48)return;const item=e.dataTransfer.getData('application/x-merge-item'),raw=e.dataTransfer.getData('application/x-merge-cell');if(editing&&item){if(!paletteItems().some(x=>x.name===item))return;draft[i]=item;paint();return}if(!/^\d+$/.test(raw))return;const a=+raw;if(a>=48||a<0)return;if(editing){[draft[a],draft[i]]=[draft[i],draft[a]];paint()}else manual(()=>sim.move(a,i))};
  });
  if(editing){
    $('#opening-cancel').onclick=()=>{editing=false;renderBoard()};$('#opening-apply').onclick=applyEditor;
    $('#opening-energy').oninput=e=>{draftEnergy=Number(e.target.value);paintStatus()};$('#opening-eraser').onclick=()=>{erase=!erase;$('#opening-eraser').classList.toggle('selected',erase);paintPalette();paint()};
    $('#palette-search').oninput=e=>{paletteQuery=e.target.value;palettePage=1;paintPalette()};$('#palette-os').onchange=e=>{paletteOS=e.target.value;palettePage=1;paintPalette()};$('#palette-type').onchange=e=>{paletteType=e.target.value;palettePage=1;paintPalette()};$('#palette-prev').onclick=()=>{palettePage--;paintPalette()};$('#palette-next').onclick=()=>{palettePage++;paintPalette()};
    $('#opening-clear').onclick=()=>{draft=Array(56).fill(null);paint()};$('#opening-current').onclick=()=>{draft=sim.exportLayout();draftEnergy=sim.energy;$('#opening-energy').value=draftEnergy;paint()};if($('#opening-load'))$('#opening-load').onclick=()=>{const saved=savedOpening();try{sim.validateOpening(saved.layout,saved.energy);draft=[...saved.layout];draftEnergy=saved.energy;$('#opening-energy').value=draftEnergy;paint()}catch(e){toast(e.message)}};
    return;
  }
  $('#robot-play').onclick=()=>player.playing?stopRobot():player.start();$('#robot-step').onclick=()=>player.single();
  $('#robot-reset').onclick=()=>{resetRobot();renderBoard()};$('#robot-undo').onclick=()=>manual(()=>sim.undo());$('#robot-refill').onclick=()=>manual(()=>sim.refill());
  document.querySelectorAll('[data-robot-speed]').forEach(b=>b.onclick=()=>{speed=+b.dataset.robotSpeed;player.setSpeed(speed)});document.querySelectorAll('[data-strategy]').forEach(b=>b.onclick=()=>changeRobotPolicy(b.dataset.strategy,focus));if($('#robot-focus'))$('#robot-focus').onchange=e=>changeRobotPolicy(policy,e.target.value);
  $('#robot-opening').onchange=e=>{opening=e.target.value;resetRobot();renderBoard()};$('#robot-craft').closest('details').ontoggle=()=>{if($('#robot-craft').closest('details').open)paintCraft()};
}
