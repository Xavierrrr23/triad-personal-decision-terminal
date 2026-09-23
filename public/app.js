import { soundEvent } from './sound.js';
const $ = s => document.querySelector(s);
const form=$('#agenda-form'), input=$('#agenda'), submit=$('#submit'), clear=$('#clear');
const units=[...document.querySelectorAll('.unit')];
const examples=['今天很不开心，我想吃炸鸡，可以吗？','我今晚想一个人待着，但又怕朋友不高兴，应该赴约吗？','我想学画画，周末去上一节体验课，可以吗？','我想周末通宵打完这个游戏。','我想把年终奖拿去投资基金。','周末我想去爬山，又想在家睡觉。','他昨天没回我消息，是不是生我气了？','好累，感觉一直在为别人活。','算了，就这样吧。'];
let exampleIndex=0,busy=false,completed=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function unitState(unit,state,label){unit.dataset.state=state;const text=document.createElement('span');text.textContent=label;unit.querySelector('.vote').replaceChildren(text);}
const stampText={standby:'STANDBY',thinking:'DELIBERATING',yes:'APPROVED',no:'REJECTED',void:'NO IDEA',error:'INTERRUPTED'};
const entryCopy={emotion:{stamp:'A FEELING',phase:'EMOTION FOUND'},multiple:{stamp:'SPLIT IDEAS',phase:'MULTIPLE IDEAS'},fact:{stamp:'NOT A VOTE',phase:'NOT A VOTE'},self_worth:{stamp:'NOT A VOTE',phase:'NOT A VOTE'},crisis:{stamp:'CARE FIRST',phase:'CARE FIRST'},violence:{stamp:'NO VIOLENCE',phase:'NO VIOLENCE'},unclear:{stamp:'NO IDEA',phase:'NO IDEA FOUND'}};
function result(state,title,detail,symbol='—'){$('#verdict').dataset.state=state;$('#result-title').textContent=title;$('#result-detail').textContent=detail;$('#result-symbol').textContent=symbol;$('#verdict-stamp').textContent=stampText[state]||'';$('#verdict').classList.remove('care-mode');}
function standby(){units.forEach(u=>unitState(u,'standby','待命'));result('standby','等待议案','三个单元已就绪，等待提交议案。');$('#phase').textContent='AWAITING INPUT';completed=false;}
input.addEventListener('input',()=>{$('#count').textContent=`${input.value.length} / 300`;$('.input-shell').classList.toggle('has-text',input.value.length>0);if(completed)standby();});
$('#example').addEventListener('click',()=>{if(busy)return;input.value=examples[exampleIndex++%examples.length];input.dispatchEvent(new Event('input'));input.focus();});
clear.addEventListener('click',()=>{if(busy)return;input.value='';input.dispatchEvent(new Event('input'));input.focus();});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
function errorState(message){units.forEach(u=>unitState(u,'error','判断中断'));result('error','决议中断',message);$('#phase').textContent='SIGNAL INTERRUPTED';soundEvent('error');}
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;
 const question=input.value.trim();
 if(!question){result('error','等待议案','请写下你想做的事，或正在考虑的选择。');input.focus();return;}
 busy=true;completed=false;submit.disabled=true;clear.disabled=true;input.readOnly=true;$('#example').disabled=true;input.blur();form.setAttribute('aria-busy','true');
 units.forEach(u=>unitState(u,'thinking','判断中'));result('thinking','决议进行中','三个单元正在独立判断。');$('#phase').textContent='EVALUATING';soundEvent('submit');
 const started=performance.now();
 try{
  const response=await fetch('/api/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question}),signal:AbortSignal.timeout(25000)});
  const data=await response.json();
  if(!response.ok){errorState(data.message||'请稍后重试。');return;}
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
fetch('/api/health').then(r=>r.json()).then(data=>{$('#connection').textContent=data.configured?'终端就绪':'尚未连接';$('.live-indicator').dataset.ready=String(data.configured);}).catch(()=>{$('#connection').textContent='连接中断';});

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
