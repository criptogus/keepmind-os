import {it,expect} from 'vitest';
import {ProjectManager} from '../src/main/projects/ProjectManager';
import {pageItems,patchProjectAccess} from '../src/shared/projects';
function fixture(){const settings=new Map<string,string>(),agents=new Map<string,any>(),skills=new Map<string,any>(),teams=new Map<string,any>();
 skills.set('s',{id:'s',name:'Research',toolNames:[],prompt:'Evidence',createdAt:'',updatedAt:''});
 agents.set('a',{id:'a',name:'Lead',config:{model:'fixture',tools:[{name:'shell_exec'},{name:'artifact_create'}],skillIds:['s']},permissions:{},capabilities:[]});
 teams.set('t',{id:'t',name:'Team',agentIds:['a'],workflow:{steps:[],executionMode:'sequential'}});
 const manager=new ProjectManager({getSetting:k=>settings.get(k),setSetting:(k,v)=>{settings.set(k,v);},getAgent:id=>agents.get(id)||null,getSkill:id=>skills.get(id)||null,getTeam:id=>teams.get(id)||null,saveAgent:a=>{agents.set(a.id,a);},saveSkill:s=>{skills.set(s.id,s);},saveTeam:t=>{teams.set(t.id,t);}});return {manager,agents,skills,teams};}
it('creates independent project teams and skills without copying external authority',()=>{
 const {manager,agents,skills}=fixture();const first=manager.create({name:'A',objective:'More leads',teamId:'t'}),second=manager.create({name:'B',objective:'Lower CAC',teamId:'t'});
 expect(first.agentIds).not.toEqual(second.agentIds);expect(first.skillIds).not.toEqual(second.skillIds);
 expect(agents.get(first.agentIds[0]).config.projectId).toBe(first.id);expect(agents.get(first.agentIds[0]).config.tools).toEqual([{name:'artifact_create'}]);
 skills.get(first.skillIds[0]).prompt='A only';expect(skills.get(second.skillIds[0]).prompt).toBe('Evidence');expect(()=>manager.assertAgent(first.id,second.agentIds[0])).toThrow('another project');
});
it('inherits only explicitly selected company resources; local rules cannot replace company rules',()=>{
 const {manager}=fixture();const p=manager.create({name:'A',objective:'Leads',teamId:'t',guardrails:'Project rule'});
 manager.saveStandard({id:'company',name:'Company',connectionIds:['gmail-company'],skillIds:['s'],voice:'Warm',guardrails:'Never publish without approval'});
 p.access={companyId:'company',inheritConnections:true,inheritSkills:true,policy:{connectionIds:['outlook-project'],skillIds:[],voice:'Direct',guardrails:'Additional rule'}};
 expect(manager.effective(p)).toMatchObject({connectionIds:['gmail-company'],voice:'Direct'});expect(manager.effective(p).guardrails).toContain('Never publish');
 p.access.inheritConnections=false;expect(manager.effective(p).connectionIds).toEqual(['outlook-project']);p.access.policy.connectionIds=[];expect(manager.effective(p).connectionIds).toEqual([]);
});
it('clamps pagination after filtering/deletion and does not render every task',()=>{const items=Array.from({length:250},(_,i)=>i);expect(pageItems(items,2).items).toEqual(items.slice(12,24));expect(pageItems(items.slice(0,3),20)).toEqual({items:[0,1,2],page:1,pages:1,total:3});});

it('patching voice preserves project accounts, skills and mandatory company association',()=>{
 const current={companyId:'11111111-1111-4111-8111-111111111111',inheritConnections:true,inheritSkills:false,policy:{connectionIds:['account'],skillIds:['skill'],voice:'Old',guardrails:'Keep this rule'}};
 const next=patchProjectAccess(current,{policy:{voice:'New'}});expect(next).toEqual({...current,policy:{...current.policy,voice:'New'}});
 expect(patchProjectAccess(current,{companyId:null}).companyId).toBeUndefined();
});
