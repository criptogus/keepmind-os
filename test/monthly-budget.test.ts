import {expect,it} from 'vitest';
import {monthlyBudgetChecker} from '../src/main/agent/monthlyBudget';
it('enforces an ephemeral execution cap against persisted spending before a call',()=>{
 let spent=4.99;const check=monthlyBudgetChecker({getAgent:()=>undefined,getAgentSpendSince:()=>spent});
 expect(()=>check('configuration-local','fixture',0.005,5)).not.toThrow();
 spent=5;expect(()=>check('configuration-local','fixture',0.001,5)).toThrow('Monthly budget exceeded');
 spent=5.1;expect(()=>check('configuration-local','fixture',0,5)).toThrow('Monthly budget exceeded');
});
it('does not let an execution cap raise a stored agent limit',()=>{
 const check=monthlyBudgetChecker({getAgent:()=>({name:'Assistant',config:{monthlyBudgetUsd:1}}),getAgentSpendSince:()=>1});
 expect(()=>check('agent','fixture',0.01,5)).toThrow('Monthly budget exceeded');
});
