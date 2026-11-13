import { randomUUID } from 'node:crypto';
import { projectInputSchema, type ProjectInput, type Project, type CompanyStandard, type ProjectAccess } from '../../shared/projects.js';
import type { Agent, Skill, Team } from '../../shared/types.js';
interface Store {
  getSetting(k:string):string|null|undefined; setSetting(k:string,v:string):void;
  getTeam(id:string):Team|null; getAgent(id:string):Agent|null; getSkill(id:string):Skill|null;
  saveTeam(t:Team):void; saveAgent(a:Agent):void; saveSkill(s:Skill):void;
}
/** Resource copies avoid retroactively changing legacy projects or sharing mutable personas. */
export class ProjectManager {
  constructor(private store:Store) {}
  list():Project[] { return JSON.parse(this.store.getSetting('projects.v1') || '[]'); }
  get(id:string) { const p=this.list().find(p=>p.id===id); if(!p)throw new Error('Project not found');return p; }
  forAgent(id:string) { return this.list().find(p=>p.agentIds.includes(id)); }
  save(project:Project) { const all=this.list();this.store.setSetting('projects.v1',JSON.stringify([...all.filter(p=>p.id!==project.id),project]));return project; }
  create(raw:ProjectInput) {
    const input=projectInputSchema.parse(raw); const source=this.store.getTeam(input.teamId);
    if(!source?.agentIds.length)throw new Error('Choose a team first');
    const agents=source.agentIds.map(id=>this.store.getAgent(id));
    if(agents.some(a=>!a))throw new Error('Team has unavailable agents');
    const agentMap=new Map(source.agentIds.map(id=>[id,randomUUID()]));
    const skills=[...new Set(agents.flatMap(a=>a!.config.skillIds||[]))].map(id=>this.store.getSkill(id));
    if(skills.some(s=>!s))throw new Error('Team has unavailable skills');
    const skillMap=new Map(skills.map(s=>[s!.id,randomUUID()]));const now=new Date().toISOString();
    const p:Project={...input,id:randomUUID(),teamId:randomUUID(),agentIds:[...agentMap.values()],skillIds:[...skillMap.values()],createdAt:now};
    for(const skill of skills)this.store.saveSkill({...skill!,id:skillMap.get(skill!.id)!,usageCount:0,lastUsedAt:undefined,createdAt:now,updatedAt:now});
    for(const agent of agents)this.store.saveAgent({...agent!,id:agentMap.get(agent!.id)!,isShared:false,sharedBy:undefined,sharedAt:undefined,
      managerId:agentMap.get(agent!.managerId||''),config:{...agent!.config,projectId:p.id,skillIds:(agent!.config.skillIds||[]).map(id=>skillMap.get(id)!),
        // Start with no shared connector, filesystem or memory authority. Delegation/materials remain available.
        tools:agent!.config.tools.filter(t=>['delegate_to_agent','artifact_create'].includes(t.name))},createdAt:now,updatedAt:now});
    this.store.saveTeam({...source,id:p.teamId,name:p.name,agentIds:p.agentIds,workflow:{...source.workflow,id:randomUUID(),steps:source.workflow.steps.map(s=>({...s,agentId:agentMap.get(s.agentId)!}))},createdAt:now,updatedAt:now});
    return this.save(p);
  }
  assertAgent(projectId:string,agentId:string) { if(!this.get(projectId).agentIds.includes(agentId))throw new Error('Agent belongs to another project'); }
  standards():CompanyStandard[] { return JSON.parse(this.store.getSetting('projects.standards')||'[]'); }
  saveStandard(standard:CompanyStandard) { this.store.setSetting('projects.standards',JSON.stringify([...this.standards().filter(s=>s.id!==standard.id),standard]));return standard; }
  effective(p:Project) {
    const access=p.access;const company=access?.companyId ? this.standards().find(s=>s.id===access.companyId) : undefined;
    if(access?.companyId&&!company)throw new Error('Company standard unavailable');
    return {connectionIds:access?.inheritConnections ? company?.connectionIds||[] : access?.policy.connectionIds||[],
      skillIds:[...p.skillIds,...(access?.inheritSkills ? company?.skillIds||[] : access?.policy.skillIds||[])],
      voice:access?.policy.voice || p.voice || company?.voice || '',guardrails:[company?.guardrails,p.guardrails,access?.policy.guardrails].filter(Boolean).join('\n')};
  }
  context(p:Project) { return {name:p.name,objective:p.objective,successMetric:p.metric,toneOfVoice:this.effective(p).voice,guardrails:this.effective(p).guardrails,
    reporting:'Report progress toward the objective, evidence, blockers, recommendations and decisions needed. If data is missing, ask for it. Never invent metrics or claim improvement without evidence.'}; }
}
