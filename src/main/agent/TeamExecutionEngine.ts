import type { Agent, Team, AgentExecution } from '../../shared/types.js';

export class TeamExecutionEngine {
  async executeTeam(
    team: Team,
    agents: Agent[],
    input: Record<string, unknown>,
    executeAgent: (agentId: string, input: Record<string, unknown>) => Promise<AgentExecution>
  ): Promise<{
    teamId: string;
    status: 'completed' | 'failed' | 'partial';
    results: Array<{
      agentId: string;
      agentName: string;
      status: 'completed' | 'failed';
      output?: Record<string, unknown>;
      error?: string;
    }>;
    duration: number;
  }> {
    const startTime = Date.now();
    const results: Array<{
      agentId: string;
      agentName: string;
      status: 'completed' | 'failed';
      output?: Record<string, unknown>;
      error?: string;
    }> = [];

    const teamAgents = agents.filter(a => team.agentIds.includes(a.id));
    const workflow = team.workflow;

    if (workflow.executionMode === 'sequential') {
      // Execute steps sequentially
      for (const step of workflow.steps) {
        const agent = teamAgents.find(a => a.id === step.agentId);
        if (!agent) continue;

        try {
          const execution = await executeAgent(step.agentId, {
            ...input,
            ...step.inputs,
          });

          results.push({
            agentId: step.agentId,
            agentName: agent.name,
            status: execution.status === 'completed' ? 'completed' : 'failed',
            output: execution.output,
            error: execution.error,
          });

          // Pass output to next step
          if (execution.output) {
            Object.assign(input, execution.output);
          }
        } catch (error) {
          results.push({
            agentId: step.agentId,
            agentName: agent.name,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else if (workflow.executionMode === 'parallel') {
      // Execute all steps in parallel
      const executions = await Promise.allSettled(
        workflow.steps.map(async (step) => {
          const agent = teamAgents.find(a => a.id === step.agentId);
          if (!agent) throw new Error('Agent not found');

          const execution = await executeAgent(step.agentId, {
            ...input,
            ...step.inputs,
          });

          return {
            agentId: step.agentId,
            agentName: agent.name,
            status: execution.status === 'completed' ? 'completed' as const : 'failed' as const,
            output: execution.output,
            error: execution.error,
          };
        })
      );

      for (const result of executions) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            agentId: 'unknown',
            agentName: 'Unknown',
            status: 'failed',
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }
    } else if (workflow.executionMode === 'conditional') {
      // Execute steps with conditions
      for (const step of workflow.steps) {
        const agent = teamAgents.find(a => a.id === step.agentId);
        if (!agent) continue;

        // Evaluate condition (simplified)
        if (step.condition) {
          try {
            // Simple condition evaluation - in production would use a proper expression evaluator
            const shouldExecute = this.evaluateCondition(step.condition, input);
            if (!shouldExecute) continue;
          } catch (error) {
            console.error('Condition evaluation failed:', error);
          }
        }

        try {
          const execution = await executeAgent(step.agentId, {
            ...input,
            ...step.inputs,
          });

          results.push({
            agentId: step.agentId,
            agentName: agent.name,
            status: execution.status === 'completed' ? 'completed' : 'failed',
            output: execution.output,
            error: execution.error,
          });
        } catch (error) {
          results.push({
            agentId: step.agentId,
            agentName: agent.name,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const duration = Math.max(1, Date.now() - startTime);
    const completedCount = results.filter(r => r.status === 'completed').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    let status: 'completed' | 'failed' | 'partial' = 'completed';
    if (failedCount === results.length) {
      status = 'failed';
    } else if (failedCount > 0) {
      status = 'partial';
    }

    return {
      teamId: team.id,
      status,
      results,
      duration,
    };
  }

  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    // Simple condition evaluation
    // In production, would use a proper expression evaluator like expr-eval or jexl
    try {
      // Handle simple equality checks
      if (condition.includes('===')) {
        const [left, right] = condition.split('===');
        const leftValue = this.getNestedValue(context, left.trim());
        const rightValue = right.trim().replace(/['"]/g, '');
        return leftValue === rightValue;
      }

      if (condition.includes('!==')) {
        const [left, right] = condition.split('!==');
        const leftValue = this.getNestedValue(context, left.trim());
        const rightValue = right.trim().replace(/['"]/g, '');
        return leftValue !== rightValue;
      }

      // Default to true if condition can't be evaluated
      return true;
    } catch (error) {
      console.error('Condition evaluation error:', error);
      return false;
    }
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? (current as any)[key] : undefined;
    }, obj);
  }
}
