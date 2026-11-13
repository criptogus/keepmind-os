import type { Agent, Team, AgentExecution } from '../../shared/types.js';

/** Deliberately small, typed grammar. Never evaluate JavaScript from a workflow. */
export function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  const match = condition.match(/^\s*([\w.]+)\s*(===|!==|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!match) throw new Error(`Invalid condition: ${condition}`);
  const [, field, op, raw] = match;
  if (field.split('.').some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('Invalid field');
  let right: unknown;
  try { right = JSON.parse(raw); }
  catch { if (/^'[^']*'$/.test(raw)) right = raw.slice(1, -1); else throw new Error('Condition value must be a JSON literal'); }
  const left = field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, context);
  if (op === '===') return left === right;
  if (op === '!==') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') throw new Error('Ordered comparisons require numbers');
  return op === '>' ? left > right : op === '<' ? left < right : op === '>=' ? left >= right : left <= right;
}

export class TeamExecutionEngine {
  async executeTeam(team: Team, agents: Agent[], input: Record<string, unknown>, executeAgent: (id: string, input: Record<string, unknown>) => Promise<AgentExecution>) {
    const start = Date.now();
    const context = { ...input };
    const results: Array<{ agentId: string; agentName: string; status: 'completed' | 'failed'; output?: Record<string, unknown>; error?: string }> = [];
    const steps = team.workflow.steps;
    const ids = new Set(steps.map(s => s.id));
    if (ids.size !== steps.length || steps.some(s => s.dependsOn?.some(id => !ids.has(id) || id === s.id))) throw new Error('Invalid workflow dependencies');
    // Validate the entire DAG before any side effect.
    const visited = new Set<string>(); const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('Cyclic workflow dependencies');
      if (visited.has(id)) return;
      visiting.add(id); steps.find(s => s.id === id)?.dependsOn?.forEach(visit);
      visiting.delete(id); visited.add(id);
    };
    ids.forEach(visit);
    const done = new Set<string>(); const failed = new Set<string>();
    while (done.size < steps.length) {
      const ready = steps.filter(s => !done.has(s.id) && (s.dependsOn || []).every(id => done.has(id)));
      const batch = team.workflow.executionMode === 'parallel' ? ready : ready.slice(0, 1);
      const outputs = await Promise.all(batch.map(async step => {
        const agent = agents.find(a => a.id === step.agentId && team.agentIds.includes(a.id));
        try {
          if (!agent) throw new Error('Agent not found');
          if (step.dependsOn?.some(id => failed.has(id))) throw new Error('Blocked by failed dependency');
          if (step.condition && !evaluateCondition(step.condition, context)) { failed.add(step.id); return undefined; }
          const execution = await executeAgent(step.agentId, { ...context, ...step.inputs });
          if (execution.status !== 'completed') throw new Error(execution.error || execution.status);
          results.push({ agentId: agent.id, agentName: agent.name, status: 'completed', output: execution.output });
          return execution.output;
        } catch (error) {
          failed.add(step.id);
          results.push({ agentId: step.agentId, agentName: agent?.name ?? 'Unknown', status: 'failed', error: error instanceof Error ? error.message : String(error) });
          return undefined;
        } finally { done.add(step.id); }
      }));
      outputs.forEach(output => { if (output) Object.assign(context, output); });
      // A sequential failure must not run downstream steps without explicit recovery.
      if (team.workflow.executionMode === 'sequential' && batch.some(s => failed.has(s.id))) break;
    }
    const failures = results.filter(r => r.status === 'failed').length;
    const status: 'completed' | 'failed' | 'partial' = failures ? failures === results.length ? 'failed' : 'partial' : 'completed';
    return { teamId: team.id, status, results, duration: Math.max(1, Date.now() - start) };
  }
}
