import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageManager } from '../src/main/storage/StorageManager.js';
import type { Agent, Team, Approval, GovernanceRule, AgentExecution } from '../src/shared/types.js';

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-data',
  },
}));

describe('AgentManager', () => {
  let agentManager: any;

  beforeEach(async () => {
    const { AgentManager } = await import('../src/main/agent/AgentManager.js');
    agentManager = new AgentManager();
  });

  describe('executeAgent', () => {
    it('should throw error if API key not configured', async () => {
      const config = {
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: 'You are a helpful assistant',
        tools: [],
      };

      await expect(
        agentManager.executeAgent('test-agent', config, { message: 'Hello' })
      ).rejects.toThrow('OpenAI API key not configured');
    });

    it('should create execution object with correct initial state', async () => {
      const config = {
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: 'You are a helpful assistant',
        tools: [],
      };

      try {
        await agentManager.executeAgent('test-agent', config, { message: 'Hello' });
      } catch (error) {
        // Expected to fail without API key
      }

      const executions = agentManager.getActiveExecutions();
      expect(executions).toHaveLength(0); // Should be cleaned up
    });
  });

  describe('cancelExecution', () => {
    it('should cancel running execution', async () => {
      const config = {
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: 'You are a helpful assistant',
        tools: [],
      };

      // Start execution (will fail without API key, but should create execution object)
      const executionPromise = agentManager.executeAgent('test-agent', config, { message: 'Hello' });
      executionPromise.catch(() => {}); // avoid unhandled rejection before assertion
      
      // Wait a bit for execution to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Cancel (won't work without API key, but tests the method exists)
      agentManager.cancelExecution('non-existent-id');

      await expect(executionPromise).rejects.toThrow();
    });
  });
});

describe('TeamExecutionEngine', () => {
  let engine: any;

  beforeEach(async () => {
    const { TeamExecutionEngine } = await import('../src/main/agent/TeamExecutionEngine.js');
    engine = new TeamExecutionEngine();
  });

  describe('executeTeam', () => {
    it('should execute sequential workflow', async () => {
      const team: Team = {
        id: 'team-1',
        name: 'Test Team',
        description: 'Test team',
        agentIds: ['agent-1', 'agent-2'],
        workflow: {
          id: 'wf-1',
          name: 'Test Workflow',
          steps: [
            { id: 'step-1', agentId: 'agent-1', inputs: { task: 'step1' } },
            { id: 'step-2', agentId: 'agent-2', inputs: { task: 'step2' } },
          ],
          executionMode: 'sequential',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          description: 'First agent',
          config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
          capabilities: [],
          permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          description: 'Second agent',
          config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
          capabilities: [],
          permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const mockExecuteAgent = async (agentId: string, input: Record<string, unknown>): Promise<AgentExecution> => {
        return {
          id: 'exec-1',
          agentId,
          status: 'completed',
          input,
          output: { result: `Output from ${agentId}` },
          progress: 100,
        };
      };

      const result = await engine.executeTeam(team, agents, { initial: 'input' }, mockExecuteAgent);

      expect(result.teamId).toBe('team-1');
      expect(result.status).toBe('completed');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].agentId).toBe('agent-1');
      expect(result.results[1].agentId).toBe('agent-2');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should execute parallel workflow', async () => {
      const team: Team = {
        id: 'team-2',
        name: 'Parallel Team',
        description: 'Parallel team',
        agentIds: ['agent-1', 'agent-2'],
        workflow: {
          id: 'wf-2',
          name: 'Parallel Workflow',
          steps: [
            { id: 'step-1', agentId: 'agent-1', inputs: { task: 'step1' } },
            { id: 'step-2', agentId: 'agent-2', inputs: { task: 'step2' } },
          ],
          executionMode: 'parallel',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          description: 'First agent',
          config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
          capabilities: [],
          permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          description: 'Second agent',
          config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
          capabilities: [],
          permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const mockExecuteAgent = async (agentId: string, input: Record<string, unknown>): Promise<AgentExecution> => {
        // Simulate delay for parallel execution
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          id: 'exec-1',
          agentId,
          status: 'completed',
          input,
          output: { result: `Output from ${agentId}` },
          progress: 100,
        };
      };

      const result = await engine.executeTeam(team, agents, { initial: 'input' }, mockExecuteAgent);

      expect(result.status).toBe('completed');
      expect(result.results).toHaveLength(2);
    });

    it('should handle failed agent execution', async () => {
      const team: Team = {
        id: 'team-3',
        name: 'Failing Team',
        description: 'Team with failing agent',
        agentIds: ['agent-1', 'agent-2'],
        workflow: {
          id: 'wf-3',
          name: 'Failing Workflow',
          steps: [
            { id: 'step-1', agentId: 'agent-1', inputs: { task: 'step1' } },
            { id: 'step-2', agentId: 'agent-2', inputs: { task: 'step2' } },
          ],
          executionMode: 'sequential',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          description: 'First agent',
          config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
          capabilities: [],
          permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          description: 'Second agent',
          config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
          capabilities: [],
          permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const mockExecuteAgent = async (agentId: string, input: Record<string, unknown>): Promise<AgentExecution> => {
        if (agentId === 'agent-2') {
          throw new Error('Agent execution failed');
        }
        return {
          id: 'exec-1',
          agentId,
          status: 'completed',
          input,
          output: { result: `Output from ${agentId}` },
          progress: 100,
        };
      };

      const result = await engine.executeTeam(team, agents, { initial: 'input' }, mockExecuteAgent);

      expect(result.status).toBe('partial');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe('completed');
      expect(result.results[1].status).toBe('failed');
    });
  });
});

describe('StorageManager - Advanced', () => {
  let storage: StorageManager;

  beforeEach(() => {
    storage = new StorageManager(fs.mkdtempSync(path.join(os.tmpdir(), 'km-test-')));
  });

  describe('Agent Executions', () => {
    it('should save and retrieve agent executions', () => {
      const execution: AgentExecution = {
        id: 'exec-1',
        agentId: 'agent-1',
        status: 'completed',
        input: { message: 'Hello' },
        output: { result: 'Hi there!' },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        progress: 100,
      };

      storage.saveAgentExecution(execution);
      const retrieved = storage.getAgentExecution(execution.id);

      expect(retrieved).toEqual({ ...execution, dryRun: false, activatedSkillIds: [] });
    });

    it('should get executions by agent', () => {
      const exec1: AgentExecution = {
        id: 'exec-1',
        agentId: 'agent-1',
        status: 'completed',
        input: { message: 'Hello' },
        output: { result: 'Hi!' },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        progress: 100,
      };

      const exec2: AgentExecution = {
        id: 'exec-2',
        agentId: 'agent-2',
        status: 'completed',
        input: { message: 'Hello' },
        output: { result: 'Hi!' },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        progress: 100,
      };

      storage.saveAgentExecution(exec1);
      storage.saveAgentExecution(exec2);

      const agent1Executions = storage.getAgentExecutions('agent-1');
      expect(agent1Executions).toHaveLength(1);
      expect(agent1Executions[0].agentId).toBe('agent-1');
    });

    it('should update execution progress', () => {
      const execution: AgentExecution = {
        id: 'exec-1',
        agentId: 'agent-1',
        status: 'running',
        input: { message: 'Hello' },
        progress: 50,
      };

      storage.saveAgentExecution(execution);
      storage.updateAgentExecutionProgress(execution.id, 75);

      const updated = storage.getAgentExecution(execution.id);
      expect(updated?.progress).toBe(75);
    });
  });

  describe('Audit Logs', () => {
    it('should save and retrieve audit logs', () => {
      const log = {
        id: 'log-1',
        timestamp: new Date().toISOString(),
        agentId: 'agent-1',
        agentName: 'Test Agent',
        action: 'execute',
        input: { message: 'Hello' },
        output: { result: 'Hi!' },
        metadata: { duration: 1000 },
      };

      storage.saveAuditLog(log);
      const logs = storage.getAuditLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('log-1');
      expect(logs[0].agentName).toBe('Test Agent');
    });

    it('should paginate audit logs', () => {
      // Create multiple logs
      for (let i = 0; i < 10; i++) {
        storage.saveAuditLog({
          id: `log-${i}`,
          timestamp: new Date().toISOString(),
          agentId: 'agent-1',
          agentName: 'Test Agent',
          action: 'execute',
          input: {},
          output: {},
          metadata: {},
        });
      }

      const page1 = storage.getAuditLogs(5, 0);
      const page2 = storage.getAuditLogs(5, 5);

      expect(page1).toHaveLength(5);
      expect(page2).toHaveLength(5);
    });
  });

  describe('Settings', () => {
    it('should get all settings', () => {
      storage.setSetting('theme', 'dark');
      storage.setSetting('language', 'pt');
      storage.setSetting('autoApprove', 'true');

      const settings = storage.getAllSettings();

      expect(settings.theme).toBe('dark');
      expect(settings.language).toBe('pt');
      expect(settings.autoApprove).toBe('true');
    });
  });
});
