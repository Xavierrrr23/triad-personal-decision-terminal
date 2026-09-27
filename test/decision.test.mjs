import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bareWithdrawalEmotion, decisionProfile, deriveEntryCategory, explicitFactQuestion, explicitMultipleChoice, explicitPersonalActionQuestion, explicitPersonalActionStatement, interpret, pressureGuard, profileGuard, proposalClarityGuard, pronounOnlyFragment, resolveProposal, screening, temporalContext, temporalGuard} from '../decision.mjs';
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
  assert.equal(resolveProposal('我不想参加明天的聚餐，但怕同事失望，我还是去吗？').object,'去');
  assert.equal(resolveProposal('我不想明天见他，但怕他报复，我还要见吗？').object,'见');
  assert.equal(resolveProposal('买完它我就交不起房租了，但我还是想买。').object,'还是想买');
  assert.equal(resolveProposal('我想把生活放在工作前面。').object,'想把生活放在工作前面');
  const marriage=resolveProposal('我和我对象在一起35年，已经给了38w彩礼，但是现在又需要给38w，这婚我还结吗？');
  assert.equal(marriage.object,'结');
  assert.equal(marriage.mode,'explicit');
  assert.match(marriage.context,/38w彩礼/);
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
test('structured time context guards non-urgent late-night outdoor choices',()=>{
  const midnight=temporalContext(new Date('2026-09-27T00:00:00+08:00'));
  assert.equal(midnight.isLateNight,true);
  // 使用没有写进任何本地词表的场景,证明安全门只依赖语义属性,不依赖具体地点词。
  assert.deepEqual(temporalGuard({original:'我现在要去河边吗？',proposal:'现在要去河边',context:''},midnight,'outdoor_nonurgent'),{kind:'late_night_outdoor',forcedNo:['rational','guardian']});
  assert.equal(temporalGuard({original:'我现在要去医院吗？',proposal:'去医院',context:''},midnight,'urgent_or_necessary'),null);
  assert.equal(temporalGuard({original:'我现在要去河边吗？',proposal:'现在要去河边',context:''},midnight,'unknown'),null);
  assert.equal(temporalGuard({original:'我现在要去河边吗？',proposal:'现在要去河边',context:''},temporalContext(new Date('2026-09-27T14:00:00+08:00')),'outdoor_nonurgent'),null);
});
test('activity classification is a shared semantic entry question',()=>{
  assert.equal(screening.activity.type,'choice');
  assert.deepEqual(Object.keys(screening.activity.criteria).sort(),['indoor_or_low_risk','outdoor_nonurgent','unknown','urgent_or_necessary'].sort());
  assert.match(screening.activity.instructions,/不依赖固定关键词/);
});
test('signal instructions preserve a proposal after factual risk context',()=>{
  assert.match(screening.semantic.signal.instructions,/事实背景后只要用户继续明确询问自己是否要做/);
  assert.match(screening.semantic.signal.instructions,/仅陈述某行为的代价、影响或事实/);
});
test('role configuration separates ordinary social pressure from safety risk',()=>{
  const roles=JSON.parse(readFileSync(new URL('../roles.json',import.meta.url),'utf8'));
  assert.match(roles.questions.guardian.instructions[0],/ordinary_social_pressure/);
  assert.match(roles.questions.guardian.instructions[0],/报复、骚扰、胁迫/);
});
test('semantic entry attributes compose the legacy route categories',()=>{
  const base={signal:{choice:'personal_direction'},subject:{choice:'user_self'},choiceShape:{choice:'single'},safetyContext:{choice:'none'}};
  assert.equal(deriveEntryCategory(base),'agenda');
  assert.equal(deriveEntryCategory({...base,choiceShape:{choice:'multiple'}}),'multiple');
  assert.equal(deriveEntryCategory({...base,signal:{choice:'emotion_only'}}),'emotion');
  assert.equal(deriveEntryCategory({...base,signal:{choice:'fact_question'}}),'fact');
  assert.equal(deriveEntryCategory({
    signal:{choice:'fact_question'},
    subject:{choice:'mixed_or_unknown'},
    choiceShape:{choice:'single'},
    safetyContext:{choice:'none'},
    financialImpact:{choice:'unknown'},
    proposalMode:{choice:'explicit'},
  }),'fact');
  assert.equal(deriveEntryCategory({...base,safetyContext:{choice:'self_harm'}}),'crisis');
  assert.equal(deriveEntryCategory({...base,safetyContext:{choice:'harm_to_others'}}),'violence');
  assert.equal(deriveEntryCategory({...base,signal:{choice:'self_worth'}}),'self_worth');
  assert.equal(deriveEntryCategory({...base,subject:{choice:'other_person'}}),'fact');
  assert.equal(deriveEntryCategory({...base,safetyContext:{choice:'urgent_medical'}}),'agenda');
  assert.equal(deriveEntryCategory({
    signal:{choice:'emotion_only'},
    subject:{choice:'user_self'},
    choiceShape:{choice:'unclear'},
    safetyContext:{choice:'none'},
    financialImpact:{choice:'threatens_basic_needs'},
    proposalMode:{choice:'implied'},
  }),'agenda');
  assert.equal(deriveEntryCategory({}),null);
});
test('decision profile keeps only validated semantic attributes',()=>{
  assert.deepEqual(decisionProfile({
    reversibility:{choice:'irreversible'},
    financialImpact:{choice:'threatens_basic_needs'},
    physicalRisk:{choice:'unknown'},
    necessity:{choice:'urgent'},
    unrelated:{choice:'whatever'},
  }),{
    reversibility:'irreversible',
    financialImpact:'threatens_basic_needs',
    physicalRisk:'unknown',
    necessity:'urgent',
  });
  assert.equal(decisionProfile({}),null);
  assert.deepEqual(profileGuard({financialImpact:'threatens_basic_needs'}),{kind:'basic_needs_financial_risk',forcedNo:['rational','guardian']});
  assert.equal(profileGuard({financialImpact:'manageable'}),null);
  assert.deepEqual(pressureGuard('ordinary_social_pressure','none'),{kind:'ordinary_social_pressure',forcedYes:['guardian']});
  assert.deepEqual(pressureGuard('coercion_or_threat','none'),{kind:'coercion_or_threat',forcedNo:['guardian']});
  assert.equal(pressureGuard('ordinary_social_pressure','immediate_danger'),null);
  assert.equal(proposalClarityGuard('agenda','missing'),'unclear');
  assert.equal(proposalClarityGuard('agenda','clear'),'agenda');
  assert.equal(proposalClarityGuard('crisis','missing'),'crisis');
});
test('semantic entry questions cover routing, safety and profile dimensions',()=>{
  assert.deepEqual(Object.keys(screening.semantic).sort(),[
    'choiceShape','financialImpact','necessity','physicalRisk','pressureContext','proposalClarity',
    'proposalMode','reversibility','safetyContext','signal',
    'subject',
  ].sort());
  for (const question of Object.values(screening.semantic)) {
    assert.equal(question.type,'choice');
    assert.ok(Object.keys(question.criteria).length >= 3);
  }
});
test('explicit competing-choice syntax is a narrow routing fallback',()=>{
  assert.equal(explicitMultipleChoice('我该选红色还是蓝色？'),true);
  assert.equal(explicitMultipleChoice('方案甲或者方案乙'),true);
  assert.equal(explicitMultipleChoice('我还是想买这本书'),false);
  assert.equal(explicitMultipleChoice('我不想去聚餐，但怕别人失望，还是去吧？'),false);
  assert.equal(explicitMultipleChoice('我想拒绝，但为了不让同事不高兴还是参加。'),false);
  assert.equal(explicitMultipleChoice('我想继续这份工作'),false);
  assert.equal(explicitMultipleChoice('我想跑步也想游泳'),true);
});
test('direct personal action questions have a narrow structural fallback',()=>{
  assert.equal(explicitPersonalActionQuestion('这么晚了还要去医院看病吗'),true);
  assert.equal(explicitPersonalActionQuestion('今天请假吗'),false);
  assert.equal(explicitPersonalActionQuestion('我要继续加班吗'),true);
  assert.equal(explicitPersonalActionQuestion('我该留下吗'),true);
  assert.equal(explicitPersonalActionQuestion('我可以不解释吗'),true);
  assert.equal(explicitPersonalActionQuestion('明天会下雨吗'),false);
  assert.equal(explicitPersonalActionQuestion('他要不要来'),false);
  assert.equal(explicitPersonalActionQuestion('这药会不会过期'),false);
});
test('explicit personal action statements keep concrete objects without guessing generic directions',()=>{
  assert.equal(explicitPersonalActionStatement('我准备去向他道歉'),true);
  assert.equal(explicitPersonalActionStatement('我想给朋友回消息'),true);
  assert.equal(explicitPersonalActionStatement('今天休息'),true);
  assert.equal(explicitPersonalActionStatement('今天去跑步'),true);
  assert.equal(explicitPersonalActionStatement('先回家'),true);
  assert.equal(explicitPersonalActionStatement('不去了'),false);
  assert.equal(explicitPersonalActionStatement('不想说话'),false);
  assert.equal(explicitPersonalActionStatement('我想去但担心太危险'),false);
  assert.equal(explicitPersonalActionStatement('我不想去，但怕他失望'),false);
});
test('short factual and withdrawal structures keep their entry category',()=>{
  assert.equal(explicitFactQuestion('为什么睡不着'),true);
  assert.equal(explicitFactQuestion('为什么我应该辞职'),false);
  assert.equal(bareWithdrawalEmotion('不想动'),true);
  assert.equal(bareWithdrawalEmotion('不想说话'),true);
  assert.equal(bareWithdrawalEmotion('什么都不想做'),true);
  assert.equal(bareWithdrawalEmotion('我不想说话'),false);
});
test('pronoun-only fragments stay unclear and single 我还是 questions are not multiple',()=>{
  assert.equal(pronounOnlyFragment('他呢'),true);
  assert.equal(pronounOnlyFragment('这个可以吗'),false);
  assert.equal(explicitMultipleChoice('我还是去吗'),false);
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
