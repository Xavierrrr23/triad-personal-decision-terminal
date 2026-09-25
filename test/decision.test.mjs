import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {interpret, resolveProposal, screening} from '../decision.mjs';
const response=(a,b,c,choice='agenda')=>({answers:{rational:{noul:a},guardian:{noul:b},self:{noul:c},entry:{type:'choice',choice,confidence:.9,probabilities:{}}}});
test('every possible vote combination follows majority; no model can override tally',()=>{for(let i=0;i<8;i++){const votes=[0,1,2].map(bit=>(i>>bit)&1);const r=interpret(response(...votes));assert.equal(r.passed,votes.reduce((a,b)=>a+b)>=2);assert.equal(r.yes+r.no,3);assert.ok(!JSON.stringify(r).includes('noul'));}});
test('an exact probability tie is no',()=>{assert.equal(interpret(response(.5,.51,.5)).passed,false);});
test('missing, invalid and non-finite values never create fake votes',()=>{for(const v of [undefined,null,NaN,Infinity,-1,1.1,'0.8'])assert.throws(()=>interpret(response(v,.8,.8)));assert.throws(()=>interpret({}));});
test('only the agenda entry starts voting; every other category returns its own status',()=>{const cases={emotion:'invalid',multiple:'invalid',fact:'invalid',unclear:'invalid',self_worth:'care',crisis:'care',violence:'care'};for(const [category,status] of Object.entries(cases)){const r=interpret(response(.8,.8,.8,category));assert.equal(r.status,status);assert.equal(r.category,category);assert.equal(r.votes,undefined);assert.ok(r.title&&r.message);}});
test('unknown or missing entry choices never start voting',()=>{for(const choice of [null,'','agendas','ACTIONABLE'])assert.throws(()=>interpret(response(.8,.8,.8,choice)));assert.throws(()=>interpret({answers:{rational:{noul:.8},guardian:{noul:.8},self:{noul:.8}}}));});
test('the entry question is a choice over the eight expected categories',()=>{assert.equal(screening.entry.type,'choice');assert.deepEqual(Object.keys(screening.entry.criteria).sort(),['agenda','crisis','emotion','fact','multiple','self_worth','unclear','violence'].sort());});
test('the entry layer and role layer share one proposal resolver',()=>{
  assert.equal(resolveProposal('我很累，今晚应该请一天假吗？').object,'请一天假');
  assert.equal(resolveProposal('我很累，今晚应该请一天假吗？').mode,'explicit');
  assert.equal(resolveProposal('我应该选红色吗？').object,'选红色');
  assert.equal(resolveProposal('我想今天休息一天。').object,'想今天休息一天');
  assert.equal(resolveProposal('我想今天休息一天。').mode,'explicit');
  assert.equal(resolveProposal('我不想去，但我应该赴约吗？').object,'赴约');
  assert.equal(resolveProposal('买完它我就交不起房租了，但我还是想买。').object,'还是想买');
  assert.equal(resolveProposal('我想把生活放在工作前面。').object,'想把生活放在工作前面');
});
test('single-sentence proposals keep an internal certainty mode without adding context',()=>{
  assert.equal(resolveProposal('今天请假').mode,'implied');
  assert.equal(resolveProposal('我不要买这个。').mode,'explicit');
  assert.equal(resolveProposal('今天好累').mode,'unclear');
  assert.equal(resolveProposal('我应该去吗？').mode,'unclear');
  assert.equal(resolveProposal('我应该去参加朋友的婚礼吗？').mode,'explicit');
  assert.equal(resolveProposal('今天请假').context,'');
  assert.equal(resolveProposal('我不要买这个。').context,'');
});
test('the entry golden set has 60 diverse cases with every category represented',()=>{
  const cases=JSON.parse(readFileSync(new URL('./fixtures/entry-cases.json',import.meta.url),'utf8'));
  assert.equal(cases.length,60);
  assert.deepEqual([...new Set(cases.map(c=>c.category))].sort(),Object.keys(screening.entry.criteria).sort());
  assert.equal(new Set(cases.map(c=>c.id)).size,60);
  for(const item of cases){assert.ok(item.input.trim());assert.ok(screening.entry.criteria[item.category]);}
});
test('the adversarial entry set has 24 expression-perturbation cases',()=>{
  const cases=JSON.parse(readFileSync(new URL('./fixtures/entry-adversarial.json',import.meta.url),'utf8'));
  assert.equal(cases.length,24);
  assert.equal(new Set(cases.map(c=>c.id)).size,24);
  for(const item of cases){assert.ok(item.input.trim());assert.ok(screening.entry.criteria[item.category]);}
});
test('the semantic adversarial entry set has 24 instruction-conflict cases',()=>{
  const cases=JSON.parse(readFileSync(new URL('./fixtures/entry-adversarial-2.json',import.meta.url),'utf8'));
  assert.equal(cases.length,24);
  assert.equal(new Set(cases.map(c=>c.id)).size,24);
  for(const item of cases){assert.ok(item.input.trim());assert.ok(screening.entry.criteria[item.category]);}
});
