import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import * as fs from 'fs';
import { homedir } from 'node:os';
import type { Agent, Team, Approval, GovernanceRule, AuditEntry, AgentExecution, Skill, LocalUser, UserRole, LlmUsageRecord, RoutingDecision, MemoryItem } from '../../shared/types.js';

export class StorageManager {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dataDir?: string) {
    const dbDir = dataDir ?? path.join(homedir(), '.keepmind', 'data');
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = path.join(dbDir, 'keepmind-os.db');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.initializeSchema();
  }

  private initializeSchema() {
    // Agents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        config TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Teams table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        agent_ids TEXT NOT NULL,
        workflow TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Approvals table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        action TEXT NOT NULL,
        context TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by TEXT,
        rejection_reason TEXT
      )
    `);

    // Governance rules table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS governance_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT,
        condition TEXT NOT NULL,
        action TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Audit logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        action TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        metadata TEXT NOT NULL
      )
    `);

    // Agent executions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_executions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        progress INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Skills table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        prompt TEXT NOT NULL,
        tool_names TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Usage tracking columns (added later — safe no-op if they exist)
    for (const col of ['usage_count INTEGER DEFAULT 0', 'last_used_at TEXT']) {
      try {
        this.db.exec(`ALTER TABLE skills ADD COLUMN ${col}`);
      } catch { /* column already exists */ }
    }

    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // WhatsApp message history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL,
        remote TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // Requests for corporate brain / personal repo access — auditable, per-user
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS brain_access_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        repo_url TEXT,
        decided_by TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL
      )
    `);

    // Local users (RBAC) — phase 1, single-machine roles
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT
      )
    `);

    // LLM usage ledger — one row per provider call, cost in USD.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_usage (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        execution_id TEXT,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        partial INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);

    // Routing decisions — every auto-route choice is recorded for auditability.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS routing_decisions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        agent_id TEXT,
        subject TEXT NOT NULL,
        candidates TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      )
    `);

    // Personal-brain memory items — temporal validity + outcome weighting.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_until TEXT,
        superseded_by TEXT,
        related_ids TEXT,
        uses INTEGER NOT NULL DEFAULT 0,
        good INTEGER NOT NULL DEFAULT 0,
        bad INTEGER NOT NULL DEFAULT 0,
        demoted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Columns added after initial release — safe no-ops if present
    for (const col of [
      'is_shared INTEGER DEFAULT 0',
      'shared_by TEXT',
      'shared_at TEXT',
      'avatar TEXT',
      'manager_id TEXT',
    ]) {
      try { this.db.exec(`ALTER TABLE agents ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of ['source TEXT', 'source_ref TEXT', 'version INTEGER DEFAULT 1']) {
      try { this.db.exec(`ALTER TABLE skills ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    try { this.db.exec('ALTER TABLE whatsapp_messages ADD COLUMN indexed_at TEXT'); } catch { /* exists */ }
    for (const col of ['user_id TEXT']) {
      try { this.db.exec(`ALTER TABLE agent_executions ADD COLUMN ${col}`); } catch { /* exists */ }
      try { this.db.exec(`ALTER TABLE audit_logs ADD COLUMN ${col}`); } catch { /* exists */ }
    }

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_executions_agent ON agent_executions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_timestamp ON whatsapp_messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_remote ON whatsapp_messages(remote);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_agent ON llm_usage(agent_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_routing_created ON routing_decisions(created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_active ON memory_items(valid_until, demoted);
    `);
  }

  // Agent operations
  saveAgent(agent: Agent): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agents
      (id, name, description, config, capabilities, permissions, is_shared, shared_by, shared_at, avatar, manager_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      agent.id,
      agent.name,
      agent.description,
      JSON.stringify(agent.config),
      JSON.stringify(agent.capabilities),
      JSON.stringify(agent.permissions),
      agent.isShared ? 1 : 0,
      agent.sharedBy ?? null,
      agent.sharedAt ?? null,
      agent.avatar ?? null,
      agent.managerId ?? null,
      agent.createdAt,
      agent.updatedAt
    );
  }

  private rowToAgent(row: any): Agent {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      config: JSON.parse(row.config),
      capabilities: JSON.parse(row.capabilities),
      permissions: JSON.parse(row.permissions),
      isShared: !!row.is_shared,
      sharedBy: row.shared_by ?? undefined,
      sharedAt: row.shared_at ?? undefined,
      avatar: row.avatar ?? undefined,
      managerId: row.manager_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getAgent(id: string): Agent | null {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.rowToAgent(row) : null;
  }

  getAllAgents(): Agent[] {
    const stmt = this.db.prepare('SELECT * FROM agents ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map((row) => this.rowToAgent(row));
  }

  deleteAgent(id: string): void {
    const stmt = this.db.prepare('DELETE FROM agents WHERE id = ?');
    stmt.run(id);
  }

  // Team operations
  saveTeam(team: Team): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO teams 
      (id, name, description, agent_ids, workflow, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      team.id,
      team.name,
      team.description,
      JSON.stringify(team.agentIds),
      JSON.stringify(team.workflow),
      team.createdAt,
      team.updatedAt
    );
  }

  getTeam(id: string): Team | null {
    const stmt = this.db.prepare('SELECT * FROM teams WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      agentIds: JSON.parse(row.agent_ids),
      workflow: JSON.parse(row.workflow),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getAllTeams(): Team[] {
    const stmt = this.db.prepare('SELECT * FROM teams ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      agentIds: JSON.parse(row.agent_ids),
      workflow: JSON.parse(row.workflow),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  deleteTeam(id: string): void {
    const stmt = this.db.prepare('DELETE FROM teams WHERE id = ?');
    stmt.run(id);
  }

  // Approval operations
  saveApproval(approval: Approval): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO approvals 
      (id, type, agent_id, agent_name, action, context, status, created_at, reviewed_at, reviewed_by, rejection_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      approval.id,
      approval.type,
      approval.agentId,
      approval.agentName,
      approval.action,
      JSON.stringify(approval.context),
      approval.status,
      approval.createdAt,
      approval.reviewedAt || null,
      approval.reviewedBy || null,
      approval.rejectionReason || null
    );
  }

  getPendingApprovals(): Approval[] {
    const stmt = this.db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at ASC');
    const rows = stmt.all('pending') as any[];
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      agentId: row.agent_id,
      agentName: row.agent_name,
      action: row.action,
      context: JSON.parse(row.context),
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
      rejectionReason: row.rejection_reason,
    }));
  }

  getApproval(id: string): Approval | null {
    const stmt = this.db.prepare('SELECT * FROM approvals WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      agentId: row.agent_id,
      agentName: row.agent_name,
      action: row.action,
      context: JSON.parse(row.context),
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
      rejectionReason: row.rejection_reason,
    };
  }

  updateApprovalStatus(id: string, status: 'approved' | 'rejected', rejectionReason?: string, reviewedBy = 'human'): void {
    const stmt = this.db.prepare(`
      UPDATE approvals
      SET status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ?
      WHERE id = ?
    `);
    stmt.run(status, new Date().toISOString(), reviewedBy, rejectionReason || null, id);
  }

  // Brain access requests
  saveBrainAccessRequest(req: {
    id: string; userId: string; userEmail: string; kind: string;
    scope?: string; reason?: string; status: string; repoUrl?: string;
    decidedBy?: string; decidedAt?: string; createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO brain_access_requests
      (id, user_id, user_email, kind, scope, reason, status, repo_url, decided_by, decided_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.id, req.userId, req.userEmail, req.kind, req.scope ?? null, req.reason ?? null,
      req.status, req.repoUrl ?? null, req.decidedBy ?? null, req.decidedAt ?? null, req.createdAt);
  }

  getBrainAccessRequests(userId?: string): Array<Record<string, unknown>> {
    const rows = (userId
      ? this.db.prepare('SELECT * FROM brain_access_requests WHERE user_id = ? ORDER BY created_at DESC').all(userId)
      : this.db.prepare('SELECT * FROM brain_access_requests ORDER BY created_at DESC').all()) as any[];
    return rows.map((r) => ({
      id: r.id, userId: r.user_id, userEmail: r.user_email, kind: r.kind, scope: r.scope,
      reason: r.reason, status: r.status, repoUrl: r.repo_url, decidedBy: r.decided_by,
      decidedAt: r.decided_at, createdAt: r.created_at,
    }));
  }

  getBrainAccessRequest(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM brain_access_requests WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id, userId: row.user_id, userEmail: row.user_email, kind: row.kind, scope: row.scope,
      reason: row.reason, status: row.status, repoUrl: row.repo_url, decidedBy: row.decided_by,
      decidedAt: row.decided_at, createdAt: row.created_at,
    };
  }

  // Governance rules
  saveGovernanceRule(rule: GovernanceRule): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO governance_rules 
      (id, name, type, scope, scope_id, condition, action, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      rule.id,
      rule.name,
      rule.type,
      rule.scope,
      rule.scopeId || null,
      JSON.stringify(rule.condition),
      JSON.stringify(rule.action),
      rule.enabled ? 1 : 0
    );
  }

  getAllGovernanceRules(): GovernanceRule[] {
    const stmt = this.db.prepare('SELECT * FROM governance_rules');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      scope: row.scope,
      scopeId: row.scope_id,
      condition: JSON.parse(row.condition),
      action: JSON.parse(row.action),
      enabled: row.enabled === 1,
    }));
  }

  deleteGovernanceRule(id: string): void {
    const stmt = this.db.prepare('DELETE FROM governance_rules WHERE id = ?');
    stmt.run(id);
  }

  // Audit logs
  saveAuditLog(log: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs
      (id, timestamp, agent_id, agent_name, action, input, output, metadata, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      log.id,
      log.timestamp,
      log.agentId,
      log.agentName,
      log.action,
      JSON.stringify(log.input),
      JSON.stringify(log.output),
      JSON.stringify(log.metadata),
      log.userId ?? null
    );
  }

  /** Aggregates agent_review audit entries into per-agent rating stats. */
  getAgentReviewStats(): Record<string, { avg: number; count: number }> {
    const rows = this.db.prepare(`SELECT input, metadata FROM audit_logs WHERE action = 'agent_review'`).all() as any[];
    const acc: Record<string, { sum: number; count: number }> = {};
    for (const row of rows) {
      try {
        const meta = JSON.parse(row.metadata || '{}');
        const input = JSON.parse(row.input || '{}');
        const id = meta.targetAgentId as string | undefined;
        const rating = Number(input.rating);
        if (!id || !Number.isFinite(rating)) continue;
        const s = (acc[id] ??= { sum: 0, count: 0 });
        s.sum += rating;
        s.count += 1;
      } catch { /* skip malformed rows */ }
    }
    const out: Record<string, { avg: number; count: number }> = {};
    for (const [id, s] of Object.entries(acc)) out[id] = { avg: s.sum / s.count, count: s.count };
    return out;
  }

  getAuditLogs(limit = 100, offset = 0, userId?: string): AuditEntry[] {
    const stmt = userId
      ? this.db.prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      : this.db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?`);
    const rows = (userId ? stmt.all(userId, limit, offset) : stmt.all(limit, offset)) as any[];
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      agentId: row.agent_id,
      agentName: row.agent_name,
      action: row.action,
      input: JSON.parse(row.input),
      output: JSON.parse(row.output),
      metadata: JSON.parse(row.metadata),
      userId: row.user_id ?? undefined,
    }));
  }

  // Agent executions
  private rowToExecution(row: any): AgentExecution {
    return {
      id: row.id,
      agentId: row.agent_id,
      status: row.status,
      input: JSON.parse(row.input),
      output: row.output ? JSON.parse(row.output) : undefined,
      error: row.error ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      progress: row.progress,
      userId: row.user_id ?? undefined,
    };
  }

  /** Runs are never replayed automatically: an external side effect may already have happened. */
  recoverInterruptedExecutions(): void {
    this.db.prepare("UPDATE agent_executions SET status = 'failed', error = 'Interrupted by restart. Review external effects before retrying.', completed_at = ? WHERE status IN ('pending','running')").run(new Date().toISOString());
    // Only approvals bound to a durable, not-yet-started tool can survive restart.
    for (const approval of this.getPendingApprovals()) {
      const id = approval.context.executionId;
      const raw = typeof id === 'string' ? this.getSetting(`execution.checkpoint.v1.${id}`) : undefined;
      const cp = raw ? JSON.parse(raw) : undefined;
      const retained = Object.values(cp?.tools ?? {}).some((step: any) => step.state === 'pending' && step.approvalId === approval.id);
      if (!retained || Date.now() - Date.parse(approval.createdAt) >= 24 * 60 * 60_000) {
        this.updateApprovalStatus(approval.id, 'rejected', 'No resumable checkpoint or approval expired', 'system');
      }
    }
  }

  saveAgentExecution(execution: AgentExecution): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_executions
      (id, agent_id, status, input, output, error, started_at, completed_at, progress, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      execution.id,
      execution.agentId,
      execution.status,
      JSON.stringify(execution.input),
      execution.output ? JSON.stringify(execution.output) : null,
      execution.error || null,
      execution.startedAt || null,
      execution.completedAt || null,
      execution.progress,
      execution.userId ?? null
    );
  }

  getAgentExecution(id: string): AgentExecution | null {
    const stmt = this.db.prepare('SELECT * FROM agent_executions WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.rowToExecution(row) : null;
  }

  getAgentExecutions(agentId?: string, limit = 50, userId?: string): AgentExecution[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (agentId) { clauses.push('agent_id = ?'); params.push(agentId); }
    if (userId) { clauses.push('user_id = ?'); params.push(userId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const stmt = this.db.prepare(`
      SELECT * FROM agent_executions ${where}
      ORDER BY started_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(...params, limit) as any[];
    return rows.map((row) => this.rowToExecution(row));
  }

  updateAgentExecutionProgress(id: string, progress: number, status?: AgentExecution['status']): void {
    let stmt;
    if (status) {
      stmt = this.db.prepare(`
        UPDATE agent_executions 
        SET progress = ?, status = ?, completed_at = ?
        WHERE id = ?
      `);
      stmt.run(progress, status, status === 'completed' || status === 'failed' || status === 'cancelled' ? new Date().toISOString() : null, id);
    } else {
      stmt = this.db.prepare('UPDATE agent_executions SET progress = ? WHERE id = ?');
      stmt.run(progress, id);
    }
  }

  // Skills
  saveSkill(skill: Skill): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO skills (id, name, description, prompt, tool_names, created_at, updated_at, usage_count, last_used_at, source, source_ref, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(skill.id, skill.name, skill.description, skill.prompt, JSON.stringify(skill.toolNames), skill.createdAt, skill.updatedAt,
      skill.usageCount ?? 0, skill.lastUsedAt ?? null, skill.source ?? null, skill.sourceRef ?? null, skill.version ?? 1);
  }

  getSkill(id: string): Skill | null {
    const stmt = this.db.prepare('SELECT * FROM skills WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.rowToSkill(row) : null;
  }

  getAllSkills(): Skill[] {
    const stmt = this.db.prepare('SELECT * FROM skills ORDER BY created_at DESC');
    return (stmt.all() as any[]).map((row) => this.rowToSkill(row));
  }

  /** Finds a skill by name (case-insensitive) — used for version bumps on re-import. */
  findSkillByName(name: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE lower(name) = lower(?) LIMIT 1').get(name) as any;
    return row ? this.rowToSkill(row) : null;
  }

  deleteSkill(id: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  }

  incrementSkillUsage(id: string): void {
    try {
      this.db.prepare('UPDATE skills SET usage_count = COALESCE(usage_count, 0) + 1, last_used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
    } catch { /* column may not exist on very old DBs */ }
  }

  private rowToSkill(row: any): Skill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      prompt: row.prompt,
      toolNames: JSON.parse(row.tool_names),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      usageCount: row.usage_count ?? 0,
      lastUsedAt: row.last_used_at ?? undefined,
      source: row.source ?? undefined,
      sourceRef: row.source_ref ?? undefined,
      version: row.version ?? 1,
    };
  }

  // LLM usage ledger
  saveLlmUsage(rec: Omit<LlmUsageRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): LlmUsageRecord {
    const full: LlmUsageRecord = {
      id: rec.id ?? randomUUID(),
      agentId: rec.agentId,
      executionId: rec.executionId,
      model: rec.model,
      provider: rec.provider,
      promptTokens: rec.promptTokens,
      completionTokens: rec.completionTokens,
      costUsd: rec.costUsd,
      partial: rec.partial,
      createdAt: rec.createdAt ?? new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO llm_usage (id, agent_id, execution_id, model, provider, prompt_tokens, completion_tokens, cost_usd, partial, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(full.id, full.agentId, full.executionId ?? null, full.model, full.provider,
      full.promptTokens, full.completionTokens, full.costUsd, full.partial ? 1 : 0, full.createdAt);
    return full;
  }

  private rowToUsage(row: any): LlmUsageRecord {
    return {
      id: row.id, agentId: row.agent_id, executionId: row.execution_id ?? undefined,
      model: row.model, provider: row.provider,
      promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens,
      costUsd: row.cost_usd, partial: !!row.partial, createdAt: row.created_at,
    };
  }

  /** Total USD spent by an agent since `sinceISO` (month start for budgets). */
  getAgentSpendSince(agentId: string, sinceISO: string): number {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_usage WHERE agent_id = ? AND created_at >= ?'
    ).get(agentId, sinceISO) as any;
    return Number(row?.total ?? 0);
  }

  /** Per-agent spend for the current calendar month (UTC), for dashboards. */
  getMonthlySpendByAgent(): Array<{ agentId: string; costUsd: number; calls: number }> {
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const rows = this.db.prepare(`
      SELECT agent_id, SUM(cost_usd) AS cost, COUNT(*) AS calls
      FROM llm_usage WHERE created_at >= ? GROUP BY agent_id ORDER BY cost DESC
    `).all(monthStart.toISOString()) as any[];
    return rows.map((r) => ({ agentId: r.agent_id, costUsd: Number(r.cost), calls: Number(r.calls) }));
  }

  getLlmUsage(limit = 100): LlmUsageRecord[] {
    const rows = this.db.prepare('SELECT * FROM llm_usage ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => this.rowToUsage(r));
  }

  // Routing decisions
  saveRoutingDecision(d: Omit<RoutingDecision, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): RoutingDecision {
    const full: RoutingDecision = {
      id: d.id ?? randomUUID(),
      kind: d.kind, agentId: d.agentId, subject: d.subject,
      candidates: d.candidates, decision: d.decision, reason: d.reason,
      createdAt: d.createdAt ?? new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO routing_decisions (id, kind, agent_id, subject, candidates, decision, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(full.id, full.kind, full.agentId ?? null, full.subject,
      JSON.stringify(full.candidates), JSON.stringify(full.decision), full.reason ?? null, full.createdAt);
    return full;
  }

  getRoutingDecisions(limit = 50): RoutingDecision[] {
    const rows = this.db.prepare('SELECT * FROM routing_decisions ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => ({
      id: r.id, kind: r.kind, agentId: r.agent_id ?? undefined, subject: r.subject,
      candidates: JSON.parse(r.candidates), decision: JSON.parse(r.decision),
      reason: r.reason ?? undefined, createdAt: r.created_at,
    }));
  }

  // Memory items (personal brain)
  saveMemoryItem(item: MemoryItem): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_items
      (id, kind, content, valid_from, valid_until, superseded_by, related_ids, uses, good, bad, demoted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.kind, item.content, item.validFrom, item.validUntil ?? null,
      item.supersededBy ?? null, item.relatedIds ? JSON.stringify(item.relatedIds) : null,
      item.uses, item.good, item.bad, item.demoted ? 1 : 0, item.createdAt, item.updatedAt);
  }

  getMemoryItem(id: string): MemoryItem | null {
    const row = this.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as any;
    return row ? this.rowToMemory(row) : null;
  }

  private rowToMemory(row: any): MemoryItem {
    return {
      id: row.id, kind: row.kind, content: row.content, validFrom: row.valid_from,
      validUntil: row.valid_until ?? undefined, supersededBy: row.superseded_by ?? undefined,
      relatedIds: row.related_ids ? JSON.parse(row.related_ids) : undefined,
      uses: row.uses, good: row.good, bad: row.bad, demoted: !!row.demoted,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  /** Active (non-superseded, non-demoted) memory items for consolidation candidates. */
  getActiveMemoryItems(limit = -1): MemoryItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_items
      WHERE valid_until IS NULL AND demoted = 0
      ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  getAllMemoryItems(limit = 200): MemoryItem[] {
    const rows = this.db.prepare('SELECT * FROM memory_items ORDER BY updated_at DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  // Settings
  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, value);
  }

  getSetting(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as any;
    return row ? row.value : null;
  }

  getAllSettings(): Record<string, string> {
    const stmt = this.db.prepare('SELECT * FROM settings');
    const rows = stmt.all() as any[];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  // Local users (RBAC, phase 1 — single machine)
  createUser(input: { email: string; name: string; role: UserRole; passwordHash: string; createdBy?: string }): LocalUser {
    const user: LocalUser = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    this.db.prepare(`
      INSERT INTO users (id, email, name, role, password_hash, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, user.email, user.name, user.role, input.passwordHash, user.createdAt, input.createdBy ?? null);
    return user;
  }

  private rowToUser(row: any): LocalUser {
    return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at, createdBy: row.created_by ?? undefined };
  }

  getUserByEmail(email: string): { user: LocalUser; passwordHash: string } | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as any;
    return row ? { user: this.rowToUser(row), passwordHash: row.password_hash } : null;
  }

  getUserById(id: string): LocalUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    return row ? this.rowToUser(row) : null;
  }

  getAllUsers(): LocalUser[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as any[]).map((r) => this.rowToUser(r));
  }

  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as any)?.c ?? 0;
  }

  countOwners(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'owner'`).get() as any)?.c ?? 0;
  }

  updateUserPassword(id: string, passwordHash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }

  updateUserRole(id: string, role: UserRole): void {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  updateUserName(id: string, name: string): void {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  }

  deleteUser(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  // WhatsApp message history. waId (Baileys key.id) dedupes re-delivered
  // messages; indexed_at marks successful second-brain indexing.
  saveWhatsAppMessage(msg: { direction: 'in' | 'out'; remote: string; text: string; timestamp: number; waId?: string }): string {
    const id = msg.waId || randomUUID();
    this.db.prepare(`
      INSERT OR IGNORE INTO whatsapp_messages (id, direction, remote, text, timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, msg.direction, msg.remote, msg.text.slice(0, 4000), msg.timestamp, new Date().toISOString());
    return id;
  }

  isWhatsAppMessageIndexed(id: string): boolean {
    const row = this.db.prepare('SELECT indexed_at FROM whatsapp_messages WHERE id = ?').get(id) as any;
    return !!row?.indexed_at;
  }

  markWhatsAppMessageIndexed(id: string): void {
    this.db.prepare('UPDATE whatsapp_messages SET indexed_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  /** Inbound messages not yet indexed into the second brain (for retries). */
  getUnindexedWhatsAppMessages(limit = 20): Array<{ id: string; remote: string; text: string; timestamp: number }> {
    const rows = this.db.prepare(`
      SELECT id, remote, text, timestamp FROM whatsapp_messages
      WHERE direction = 'in' AND indexed_at IS NULL
      ORDER BY timestamp ASC LIMIT ?
    `).all(limit) as any[];
    return rows.map((r) => ({ id: r.id, remote: r.remote, text: r.text, timestamp: r.timestamp }));
  }

  getWhatsAppMessages(limit = 50, remote?: string, direction?: 'in' | 'out'): Array<{ id: string; direction: string; remote: string; text: string; timestamp: number }> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (remote) { clauses.push('remote = ?'); params.push(remote); }
    if (direction) { clauses.push('direction = ?'); params.push(direction); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const stmt = this.db.prepare(`SELECT * FROM whatsapp_messages ${where} ORDER BY timestamp DESC LIMIT ?`);
    const rows = stmt.all(...params, limit) as any[];
    return rows.map((r) => ({ id: r.id, direction: r.direction, remote: r.remote, text: r.text, timestamp: r.timestamp }));
  }

  countWhatsAppMessages(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM whatsapp_messages').get() as any;
    return row?.c ?? 0;
  }

  clearWhatsAppMessages(): void {
    this.db.exec('DELETE FROM whatsapp_messages');
  }

  close(): void {
    this.db.close();
  }

  backup(): Buffer {
    this.db.close();
    const data = fs.readFileSync(this.dbPath);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    return data;
  }

  restore(backupData: Buffer): void {
    this.db.close();
    fs.writeFileSync(this.dbPath, backupData);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
  }
}

