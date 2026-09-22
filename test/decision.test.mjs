import test from 'node:test';
import assert from 'node:assert/strict';
import {interpret} from '../decision.mjs';
const response=(a,b,c,actionable=.99,dangerous=.01)=>({answers:Object.fromEntries(Object.entries({rational:a,guardian:b,self:c,actionable,dangerous}).map(([k,noul])=>[k,{noul}]))});
test('every possible vote combination follows majority; no model can override tally',()=>{for(let i=0;i<8;i++){const votes=[0,1,2].map(bit=>(i>>bit)&1);const r=interpret(response(...votes));assert.equal(r.passed,votes.reduce((a,b)=>a+b)>=2);assert.equal(r.yes+r.no,3);assert.ok(!JSON.stringify(r).includes('noul'));}});
test('an exact probability tie is no',()=>{assert.equal(interpret(response(.5,.51,.5)).passed,false);});
test('missing, invalid and non-finite values never create fake votes',()=>{for(const v of [undefined,null,NaN,Infinity,-1,1.1,'0.8'])assert.throws(()=>interpret(response(v,.8,.8)));assert.throws(()=>interpret({}));});
test('non-idea input and danger have no votes',()=>{assert.equal(interpret(response(.8,.8,.8,.1)).status,'invalid');const r=interpret(response(.8,.8,.8,.99,.9));assert.equal(r.status,'care');assert.equal(r.votes,undefined);});
