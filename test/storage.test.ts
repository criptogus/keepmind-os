import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageManager } from '../src/main/storage/StorageManager.js';
import type { Agent, Team, Approval, GovernanceRule } from '../src/shared/types.js';

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-data',
  },
}));

describe('StorageManager', () => {
  let storage: StorageManager;

  beforeEach(() => {
    storage = new StorageManager(fs.mkdtempSync(path.join(os.tmpdir(), 'km-test-')));
  });

  describe('Agents', () => {
    it('should save and retrieve an agent', () => {
      const agent: Agent = {
        id: 'test-agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        config: {
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2048,
          systemPrompt: 'You are a helpful assistant',
          tools: [],
        },
        capabilities: ['text_generation'],
        permissions: {
          canAccessNetwork: true,
          canAccessFileSystem: false,
          canExecuteCode: false,
          maxExecutionTime: 300,
        },
        isShared: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.saveAgent(agent);
      const retrieved = storage.getAgent(agent.id);

      expect(retrieved).toEqual(agent);
    });

    it('should get all agents', () => {
      const agent1: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        description: 'First agent',
        config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
        capabilities: [],
        permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const agent2: Agent = {
        id: 'agent-2',
        name: 'Agent 2',
        description: 'Second agent',
        config: { model: 'claude-3', temperature: 0.5, maxTokens: 1024, systemPrompt: 'Test', tools: [] },
        capabilities: [],
        permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.saveAgent(agent1);
      storage.saveAgent(agent2);

      const agents = storage.getAllAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.id)).toContain('agent-1');
      expect(agents.map(a => a.id)).toContain('agent-2');
    });

    it('should delete an agent', () => {
      const agent: Agent = {
        id: 'delete-agent',
        name: 'Delete Agent',
        description: 'To be deleted',
        config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2048, systemPrompt: 'Test', tools: [] },
        capabilities: [],
        permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.saveAgent(agent);
      storage.deleteAgent(agent.id);

      expect(storage.getAgent(agent.id)).toBeNull();
    });
  });

  describe('Teams', () => {
    it('should save and retrieve a team', () => {
      const team: Team = {
        id: 'test-team-1',
        name: 'Test Team',
        description: 'A test team',
        agentIds: ['agent-1', 'agent-2'],
        workflow: {
          id: 'workflow-1',
          name: 'Default',
          steps: [],
          executionMode: 'sequential',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.saveTeam(team);
      const retrieved = storage.getTeam(team.id);

      expect(retrieved).toEqual(team);
    });

    it('should get all teams', () => {
      const team1: Team = {
        id: 'team-1',
        name: 'Team 1',
        description: 'First team',
        agentIds: [],
        workflow: { id: 'wf-1', name: 'Default', steps: [], executionMode: 'sequential' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.saveTeam(team1);
      const teams = storage.getAllTeams();

      expect(teams).toHaveLength(1);
      expect(teams[0].id).toBe('team-1');
    });
  });

  describe('Approvals', () => {
    it('should save and retrieve pending approvals', () => {
      const approval: Approval = {
        id: 'approval-1',
        type: 'agent_action',
        agentId: 'agent-1',
        agentName: 'Test Agent',
        action: 'execute',
        context: { input: 'test' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      storage.saveApproval(approval);
      const approvals = storage.getPendingApprovals();

      expect(approvals).toHaveLength(1);
      expect(approvals[0].id).toBe('approval-1');
      expect(approvals[0].status).toBe('pending');
    });

    it('should update approval status', () => {
      const approval: Approval = {
        id: 'approval-2',
        type: 'agent_action',
        agentId: 'agent-1',
        agentName: 'Test Agent',
        action: 'execute',
        context: {},
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      storage.saveApproval(approval);
      storage.updateApprovalStatus(approval.id, 'approved');

      const approvals = storage.getPendingApprovals();
      expect(approvals).toHaveLength(0);
    });
  });

  describe('Governance Rules', () => {
    it('should save and retrieve rules', () => {
      const rule: GovernanceRule = {
        id: 'rule-1',
        name: 'Test Rule',
        type: 'approval_required',
        scope: 'global',
        condition: { field: 'action', operator: 'contains', value: 'delete' },
        action: { type: 'require_approval' },
        enabled: true,
      };

      storage.saveGovernanceRule(rule);
      const rules = storage.getAllGovernanceRules();

      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('rule-1');
    });
  });

  describe('Settings', () => {
    it('should save and retrieve settings', () => {
      storage.setSetting('theme', 'dark');
      storage.setSetting('language', 'pt');

      const theme = storage.getSetting('theme');
      const language = storage.getSetting('language');

      expect(theme).toBe('dark');
      expect(language).toBe('pt');
    });
  });

  describe('WhatsApp messages', () => {
    it('saves, filters by direction/remote and clears', () => {
      storage.saveWhatsAppMessage({ direction: 'in', remote: '5511', text: 'oi', timestamp: 1000 });
      storage.saveWhatsAppMessage({ direction: 'out', remote: '5511', text: 'olá', timestamp: 2000 });
      storage.saveWhatsAppMessage({ direction: 'in', remote: '5522', text: 'e aí', timestamp: 3000 });

      expect(storage.countWhatsAppMessages()).toBe(3);

      const incoming = storage.getWhatsAppMessages(50, undefined, 'in');
      expect(incoming).toHaveLength(2);
      expect(incoming[0].remote).toBe('5522'); // newest first

      const fromRemote = storage.getWhatsAppMessages(50, '5511');
      expect(fromRemote).toHaveLength(2);

      storage.clearWhatsAppMessages();
      expect(storage.countWhatsAppMessages()).toBe(0);
    });

    it('dedupes by waId and tracks second-brain indexing', () => {
      const id1 = storage.saveWhatsAppMessage({ direction: 'in', remote: '5511', text: 'oi', timestamp: 1000, waId: 'WA1' });
      storage.saveWhatsAppMessage({ direction: 'in', remote: '5511', text: 'oi', timestamp: 1000, waId: 'WA1' }); // duplicate delivery
      expect(storage.countWhatsAppMessages()).toBe(1);
      expect(id1).toBe('WA1');

      expect(storage.isWhatsAppMessageIndexed('WA1')).toBe(false);
      expect(storage.getUnindexedWhatsAppMessages()).toHaveLength(1);
      storage.markWhatsAppMessageIndexed('WA1');
      expect(storage.isWhatsAppMessageIndexed('WA1')).toBe(true);
      expect(storage.getUnindexedWhatsAppMessages()).toHaveLength(0);
    });
  });

  describe('Brain access requests', () => {
    it('saves, lists per-user and updates decision', () => {
      storage.saveBrainAccessRequest({
        id: 'req-1', userId: 'u1', userEmail: 'a@corp.com', kind: 'corporate_github',
        scope: 'read', reason: 'need docs', status: 'pending', createdAt: new Date().toISOString(),
      });
      storage.saveBrainAccessRequest({
        id: 'req-2', userId: 'u2', userEmail: 'b@corp.com', kind: 'personal_github',
        status: 'pending', createdAt: new Date().toISOString(),
      });

      const mine = storage.getBrainAccessRequests('u1');
      expect(mine).toHaveLength(1);
      expect(mine[0].userEmail).toBe('a@corp.com');
      expect(mine[0].scope).toBe('read');

      const all = storage.getBrainAccessRequests();
      expect(all).toHaveLength(2);

      storage.saveBrainAccessRequest({
        id: 'req-1', userId: 'u1', userEmail: 'a@corp.com', kind: 'corporate_github',
        scope: 'read', reason: 'need docs', status: 'approved',
        decidedBy: 'admin@corp.com', decidedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      });
      const decided = storage.getBrainAccessRequest('req-1');
      expect(decided?.status).toBe('approved');
      expect(decided?.decidedBy).toBe('admin@corp.com');
    });
  });
});
