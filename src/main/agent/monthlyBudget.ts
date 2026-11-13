import type { BudgetChecker } from './AgentManager.js';
/** Execution caps also cover tool-free identities which are not persisted agents. */
export function monthlyBudgetChecker(storage: {
 getAgent(id:string): {name:string;config:{monthlyBudgetUsd?:number}} | null | undefined;
 getAgentSpendSince(id:string,since:string):number;
}): BudgetChecker {
 return (agentId,_model,estimate,executionCap)=>{
  const agent=storage.getAgent(agentId);const cap=agent?.config.monthlyBudgetUsd ?? executionCap;
  if(cap===undefined || cap<=0)return;
  const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);
  const spent=storage.getAgentSpendSince(agentId,start.toISOString());
  if(spent+estimate>cap)throw new Error(`Monthly budget exceeded for "${agent?.name??agentId}": $${spent.toFixed(2)} spent + ~$${estimate.toFixed(4)} estimated > $${cap.toFixed(2)} cap`);
 };
}
