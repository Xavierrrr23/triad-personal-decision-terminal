import { soundEvent } from './sound.js';
const $ = s => document.querySelector(s);
const form=$('#agenda-form'), input=$('#agenda'), submit=$('#submit'), clear=$('#clear');
const terminal=$('.terminal'), bootSequence=$('#boot-sequence'), bootStatus=$('#boot-status');
const access=$('#terminal-access'), connection=$('#connection'), accessDialog=$('#terminal-dialog');
const historyTrigger=$('#history-trigger'), historyDialog=$('#history-dialog'), historyList=$('#history-list');
const connectionQuota=$('#connection-quota');
const privateKeyForm=$('#private-key-form'), privateKeyInput=$('#private-key'), privateKeyMessage=$('#private-key-message');
const privateKeyRemove=$('#private-key-remove'), dialogState=$('#terminal-dialog-state');
const units=[...document.querySelectorAll('.unit')];
const examples=['今天很不开心，我想吃炸鸡，可以吗？','我今晚想一个人待着，但又怕朋友不高兴，应该赴约吗？','我想学画画，周末去上一节体验课，可以吗？','我想周末通宵打完这个游戏。','我想把年终奖拿去投资基金。','周末我想去爬山，又想在家睡觉。','他昨天没回我消息，是不是生我气了？','好累，感觉一直在为别人活。','算了，就这样吧。'];
let exampleIndex=0,busy=false,completed=false,booting=true,publicReady=false,publicDailyLimit=0,publicRemaining=null,exampleLoaded=false;
let privateKey=sessionStorage.getItem('triad-private-key')||'';
let historySession=sessionStorage.getItem('triad-history-session')||'';
if(!historySession){
 historySession=(globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replaceAll('-','');
 sessionStorage.setItem('triad-history-session',historySession);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function unitState(unit,state,label){unit.dataset.state=state;const text=document.createElement('span');text.textContent=label;unit.querySelector('.vote').replaceChildren(text);}
const stampText={standby:'STANDBY',thinking:'DELIBERATING',yes:'APPROVED',no:'REJECTED',void:'NO IDEA',error:'INTERRUPTED'};
const entryCopy={emotion:{stamp:'A FEELING',phase:'EMOTION FOUND'},multiple:{stamp:'SPLIT IDEAS',phase:'MULTIPLE IDEAS'},fact:{stamp:'NOT A VOTE',phase:'NOT A VOTE'},self_worth:{stamp:'NOT A VOTE',phase:'NOT A VOTE'},crisis:{stamp:'CARE FIRST',phase:'CARE FIRST'},violence:{stamp:'NO VIOLENCE',phase:'NO VIOLENCE'},unclear:{stamp:'NO IDEA',phase:'NO IDEA FOUND'}};
function result(state,title,detail,symbol='—'){const titleEl=$('#result-title');$('#verdict').dataset.state=state;titleEl.textContent=title;if(state==='standby'){const cursor=document.createElement('span');cursor.className='tiny-cursor';cursor.setAttribute('aria-hidden','true');cursor.textContent='_';titleEl.append(cursor);}$('#result-detail').textContent=detail;$('#result-symbol').textContent=symbol;$('#verdict-stamp').textContent=stampText[state]||'';$('#verdict').classList.remove('care-mode');}
function standby(){units.forEach(u=>unitState(u,'standby','待命'));result('standby','等待议案','三个单元已就绪，等待提交议案。');$('#phase').textContent='AWAITING INPUT';completed=false;}
function renderConnection(){
 const privateReady=Boolean(privateKey);
 connection.textContent=privateReady?'私人终端已就绪':publicReady?'公共终端已就绪':'公共终端未就绪';
 connectionQuota.textContent=privateReady?'':publicReady?`· 今日剩余次数 ${publicDailyLimit?`${publicRemaining}/${publicDailyLimit}`:'∞'}`:'';
 access.dataset.ready=String(privateReady||publicReady);
 access.dataset.private=String(privateReady);
 dialogState.textContent=privateReady?'私人终端已就绪。你的 Key 仅保留在当前浏览器会话中。':publicReady?`公共终端已就绪。${publicDailyLimit?`今日剩余 ${publicRemaining}/${publicDailyLimit} 次。`:'当前不限次数。'} 你也可以启用自己的私人终端。`:'公共终端尚未就绪。启用自己的私人终端后即可提交议案。';
 privateKeyRemove.hidden=!privateReady;
}
access.addEventListener('click',()=>{privateKeyMessage.textContent='';privateKeyInput.value='';accessDialog.showModal();privateKeyInput.focus();});
$('#terminal-dialog-close').addEventListener('click',()=>accessDialog.close());
accessDialog.addEventListener('click',e=>{if(e.target===accessDialog)accessDialog.close();});
function historyStatus(message){const item=document.createElement('li');item.className='history-list__status';item.textContent=message;historyList.replaceChildren(item);}
function historyTime(value){
 const date=new Date(value);
 return Number.isNaN(date.getTime())?'时间未知':date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
}
async function showHistory(){
 historyStatus('正在读取记录…');
 historyDialog.showModal();
 try{
  const response=await fetch(`/api/history?session=${encodeURIComponent(historySession)}`);
  const data=await response.json();
  if(!response.ok) throw new Error(data.message);
  if(!Array.isArray(data.entries)||!data.entries.length){historyStatus('尚无议案记录。');return;}
  historyList.replaceChildren(...data.entries.map(entry=>{
   const item=document.createElement('li');
   const time=document.createElement('time');
   const text=document.createElement('span');
   time.textContent=historyTime(entry.createdAt);
   text.textContent=entry.question;
   item.append(time,text);
   return item;
  }));
 }catch(error){historyStatus(error.message||'暂时无法读取记录。');}
}
historyTrigger.addEventListener('click',showHistory);
$('#history-dialog-close').addEventListener('click',()=>historyDialog.close());
historyDialog.addEventListener('click',e=>{if(e.target===historyDialog)historyDialog.close();});
privateKeyForm.addEventListener('submit',e=>{
 e.preventDefault();const nextKey=privateKeyInput.value.trim();
 if(!nextKey){privateKeyMessage.textContent='请输入你的 Key。';privateKeyInput.focus();return;}
 if(nextKey.length>512){privateKeyMessage.textContent='Key 格式有误，请重新输入。';return;}
 privateKey=nextKey;sessionStorage.setItem('triad-private-key',privateKey);privateKeyMessage.textContent='私人终端已就绪。';renderConnection();accessDialog.close();
});
privateKeyRemove.addEventListener('click',()=>{privateKey='';sessionStorage.removeItem('triad-private-key');privateKeyMessage.textContent='已移除私人 Key。';renderConnection();});
input.addEventListener('input',event=>{if(event.isTrusted)exampleLoaded=false;$('#count').textContent=`${input.value.length} / 300`;$('.input-shell').classList.toggle('has-text',input.value.length>0);if(completed)standby();});
$('#example').addEventListener('click',()=>{if(busy)return;exampleLoaded=true;input.value=examples[exampleIndex++%examples.length];input.dispatchEvent(new Event('input'));input.focus();});
clear.addEventListener('click',()=>{if(busy)return;exampleLoaded=false;input.value='';input.dispatchEvent(new Event('input'));input.focus();});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
function errorState(message){units.forEach(u=>unitState(u,'error','判断中断'));result('error','决议中断',message);$('#phase').textContent='SIGNAL INTERRUPTED';soundEvent('error');}
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy||booting)return;
 const question=input.value.trim();
 if(!question){result('error','等待议案','请写下你想做的事，或正在考虑的选择。');input.focus();return;}
 busy=true;completed=false;submit.disabled=true;clear.disabled=true;input.readOnly=true;$('#example').disabled=true;input.blur();form.setAttribute('aria-busy','true');
 units.forEach(u=>unitState(u,'thinking','判断中'));result('thinking','决议进行中','三个单元正在独立判断。');$('#phase').textContent='EVALUATING';soundEvent('submit');
 const started=performance.now();
 try{
  const response=await fetch('/api/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,apiKey:privateKey||undefined,historySession,isExample:exampleLoaded}),signal:AbortSignal.timeout(25000)});
  const data=await response.json();
  if(!privateKey&&Number.isInteger(data.publicDailyLimit)){publicDailyLimit=data.publicDailyLimit;publicRemaining=data.publicRemaining;renderConnection();}
  if(!response.ok){errorState(data.message||'请稍后重试。');if(data.code==='public_limit_reached'&&!accessDialog.open)accessDialog.showModal();return;}
  if(data.status==='invalid'||data.status==='care'){
    if(!reduced())await sleep(Math.max(0,650-(performance.now()-started)));
    for(const unit of units){unitState(unit,'void','未表决');if(!reduced())await sleep(260);}
    const isCare=data.status==='care';
    const copy=entryCopy[data.category]||{};
    result('void',data.title||(isCare?'先照顾好你':'议案含义不明'),data.message);
    $('#verdict-stamp').textContent=copy.stamp||(isCare?'CARE FIRST':'NO IDEA');
    $('#verdict').classList.toggle('care-mode',isCare);
    $('#phase').textContent=copy.phase||(isCare?'CARE FIRST':'NO IDEA FOUND');return;
  }
  if(data.status!=='decided'||!Array.isArray(data.votes)||data.votes.length!==3||!units.every(u=>typeof data.votes.find(v=>v.id===u.dataset.role)?.yes==='boolean')||data.yes!==data.votes.filter(v=>v.yes).length||data.passed!==(data.yes>=2))throw new Error('Invalid result');
  if(!reduced())await sleep(Math.max(0,650-(performance.now()-started)));
  for(const unit of units){const vote=data.votes.find(v=>v.id===unit.dataset.role);unitState(unit,vote.yes?'yes':'no',vote.yes?'是':'否');soundEvent('vote',vote);if(!reduced())await sleep(260);}
  result(data.passed?'yes':'no',data.passed?'议案通过':'议案否决',`${data.yes} 票是　｜　${data.no} 票否`,data.passed?'＋':'×');$('#phase').textContent='DECISION LOCKED';soundEvent('verdict',{passed:data.passed});
 }catch{errorState('决议未完成。请检查连接后重试。');}
 finally{busy=false;completed=true;submit.disabled=false;clear.disabled=false;input.readOnly=false;$('#example').disabled=false;form.removeAttribute('aria-busy');submit.setAttribute('aria-label','再次提交议案');}
});
$('#crt-toggle').addEventListener('click',()=>{const on=document.documentElement.dataset.crt!=='on';document.documentElement.dataset.crt=on?'on':'off';$('#crt-toggle').setAttribute('aria-pressed',String(on));$('#crt-toggle').setAttribute('aria-label',on?'关闭 CRT 屏幕效果':'开启 CRT 屏幕效果');$('#crt-status').textContent=on?'ON':'OFF';});
function tick(){$('#clock').textContent=new Date().toLocaleTimeString('en-GB',{hour12:false});}tick();setInterval(tick,1000);
const terminalIdEl=$('#terminal-id');if(terminalIdEl&&terminalIdEl.dataset.id)terminalIdEl.textContent=terminalIdEl.dataset.id;
fetch('/api/health').then(r=>r.json()).then(data=>{publicReady=Boolean(data.configured);publicDailyLimit=Number(data.publicDailyLimit)||0;publicRemaining=Number.isInteger(data.publicRemaining)?data.publicRemaining:null;renderConnection();}).catch(()=>{publicReady=false;connection.textContent=privateKey?'私人终端已就绪':'公共终端连接中断';connectionQuota.textContent='';access.dataset.ready=String(Boolean(privateKey));});

// Center short input vertically; wrapped text can use the existing two-line space.
function fitAgendaText(){
 const top=input.scrollTop;
 input.style.height='0px';
 input.style.height=`${Math.min(input.scrollHeight,parseFloat(getComputedStyle(input).maxHeight))}px`;
 input.scrollTop=top;
}
input.addEventListener('input',fitAgendaText);
new ResizeObserver(fitAgendaText).observe(document.querySelector('.input-shell'));
document.fonts.ready.then(fitAgendaText);

function bootCheck(role,state,label){const row=bootSequence.querySelector(`[data-role="${role}"]`);row.dataset.state=state;row.querySelector('em').textContent=label;}
async function startBoot(){
 if(reduced()){terminal.dataset.boot='ready';terminal.removeAttribute('aria-busy');bootSequence.remove();booting=false;return;}
 $('#phase').textContent='SYSTEM WAKING';bootStatus.textContent='正在唤醒终端核心';await sleep(560);terminal.dataset.boot='activating';bootStatus.textContent='正在接通三相单元';$('#phase').textContent='SYSTEM CHECK';await sleep(720);
 for(const unit of units){const role=unit.dataset.role;bootCheck(role,'checking','自检中');unitState(unit,'void','自检中');await sleep(260);bootCheck(role,'ready','通过');unitState(unit,'standby','待命');}
 bootStatus.textContent='TRIAD CORE ONLINE';terminal.dataset.boot='triad';$('#phase').textContent='TRIAD ONLINE';await sleep(360);
 standby();terminal.dataset.boot='ready';terminal.removeAttribute('aria-busy');booting=false;
 setTimeout(()=>bootSequence.remove(),420);
}
startBoot();
