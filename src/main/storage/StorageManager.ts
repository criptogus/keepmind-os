import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import * as fs from 'fs';
import { homedir } from 'node:os';
import type { Agent, Team, Approval, GovernanceRule, AuditEntry, AgentExecution, ExecutionToolCall, Skill, LocalUser, UserRole, LlmUsageRecord, RoutingDecision, MemoryItem, Channel, ChannelKind, ChannelMessage, ChatChannelView } from '../../shared/types.js';

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

  /** Synchronous domain writes commit together or leave no partial setup. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
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

    // Tool calls executed during agent runs — the audit trail of "what the
    // agent touched". One row per event (call or result), ordered by rowid.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_tool_calls (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        args TEXT,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_etc_execution ON execution_tool_calls(execution_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_etc_created ON execution_tool_calls(created_at)`);

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

    for (const column of ['sources TEXT', 'relations TEXT']) {
      const name = column.split(' ')[0];
      const columns = this.db.prepare('PRAGMA table_info(memory_items)').all() as Array<{name:string}>;
      if (!columns.some(c => c.name === name)) this.db.exec(`ALTER TABLE memory_items ADD COLUMN ${column}`);
    }

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
    for (const col of ['dry_run INTEGER DEFAULT 0', 'activated_skills TEXT']) {
      try { this.db.exec(`ALTER TABLE agent_executions ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of ['user_id TEXT']) {
      try { this.db.exec(`ALTER TABLE agent_executions ADD COLUMN ${col}`); } catch { /* exists */ }
      try { this.db.exec(`ALTER TABLE audit_logs ADD COLUMN ${col}`); } catch { /* exists */ }
    }

    // Chat channels/messages — Slack-style workspace surface.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        topic TEXT,
        agent_id TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_agents (
        channel_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, agent_id)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_user_state (
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        last_read_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author_kind TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'done',
        execution_id TEXT,
        parent_id TEXT,
        meta TEXT,
        created_at TEXT NOT NULL
      )
    `);

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
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
    `);
    const msgCols = this.db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
    if (!msgCols.some((c) => c.name === 'parent_id')) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN parent_id TEXT`);
    }
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
      dryRun: Boolean(row.dry_run),
      activatedSkillIds: row.activated_skills ? JSON.parse(row.activated_skills) : [],
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

  getExecutionSpend(executionId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_usage WHERE execution_id = ?').get(executionId) as { total: number };
    return Number(row.total);
  }

  assertMonthlyRunCap(agentId: string, cap = 1000): void {
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 100_000) throw new Error('Invalid monthly run limit');
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM agent_executions WHERE agent_id = ? AND started_at >= ?').get(agentId, month.toISOString()) as { n: number };
    if (row.n >= cap) throw new Error('Monthly execution limit reached');
  }

  saveAgentExecution(execution: AgentExecution): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_executions
      (id, agent_id, status, input, output, error, started_at, completed_at, progress, user_id, dry_run, activated_skills)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      execution.userId ?? null,
      execution.dryRun ? 1 : 0,
      JSON.stringify(execution.activatedSkillIds ?? [])
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

  /** Persists one tool_call/tool_result event from an agent run. Best-effort. */
  saveExecutionToolEvent(executionId: string, kind: 'call' | 'result', name: string, payload: { args?: unknown; result?: unknown; error?: unknown }): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO execution_tool_calls (id, execution_id, kind, name, args, result, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        randomUUID(),
        executionId,
        kind,
        name,
        payload.args !== undefined ? JSON.stringify(payload.args) : null,
        payload.result !== undefined ? String(payload.result).slice(0, 4000) : null,
        payload.error !== undefined ? String(payload.error) : null,
        new Date().toISOString()
      );
    } catch { /* audit trail must never break a run */ }
  }

  /** All tool events for one execution, in order. */
  getExecutionToolCalls(executionId: string): ExecutionToolCall[] {
    const rows = this.db.prepare(`
      SELECT * FROM execution_tool_calls WHERE execution_id = ? ORDER BY rowid ASC
    `).all(executionId) as any[];
    return rows.map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      kind: row.kind,
      name: row.name,
      args: row.args ? JSON.parse(row.args) : undefined,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.created_at,
    }));
  }

  /** Tool usage counts since an ISO timestamp — powers governance "what agents touched". */
  getToolUsageCounts(sinceIso: string, userId?: string): Array<{ name: string; count: number }> {
    const join = userId
      ? `JOIN agent_executions e ON e.id = etc.execution_id AND e.user_id = ?`
      : '';
    const rows = this.db.prepare(`
      SELECT etc.name AS name, COUNT(*) AS count
      FROM execution_tool_calls etc ${join}
      WHERE etc.kind = 'call' AND etc.created_at >= ?
      GROUP BY etc.name ORDER BY count DESC LIMIT 20
    `).all(...(userId ? [userId, sinceIso] : [sinceIso])) as any[];
    return rows.map((r) => ({ name: r.name, count: r.count }));
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

  /**
   * Per-model execution outcomes, joining the usage ledger to execution
   * status. Powers outcome-weighted model routing: models with enough history
   * and poor success rates get demoted in favor of proven alternatives.
   */
  getOutcomeStats(agentId: string, input: Record<string, unknown>, kind: 'model' | 'skill'): Record<string, { completed: number; failed: number; total: number; successRate: number }> {
    // One vote per real execution and candidate, scoped to this agent and
    // tasks sharing at least two meaningful words (or identical task text).
    const rows = this.db.prepare(`
      SELECT e.id, e.status, e.input, e.activated_skills, u.model
      FROM agent_executions e LEFT JOIN llm_usage u ON e.id = u.execution_id
      WHERE e.agent_id = ? AND e.status IN ('completed', 'failed')
        AND COALESCE(e.dry_run, 0) = 0
        AND COALESCE(json_extract(e.output, '$.dryRun'), 0) = 0
      GROUP BY e.id, u.model
    `).all(agentId) as any[];
    const taskText = (value: Record<string, unknown>) => String(value.task ?? value.goal ?? value.prompt ?? '').toLowerCase();
    const text = taskText(input);
    const tokens = new Set(text.match(/[\p{L}]{4,}/gu) ?? []);
    const seen = new Set<string>();
    const out: Record<string, { completed: number; failed: number; total: number; successRate: number }> = {};
    for (const row of rows) {
      const previous = taskText(JSON.parse(row.input));
      const shared = new Set((previous.match(/[\p{L}]{4,}/gu) ?? []).filter((word: string) => tokens.has(word)));
      if (!text || (previous !== text && shared.size < 2)) continue;
      const ids: string[] = kind === 'model' ? (row.model ? [row.model] : []) : JSON.parse(row.activated_skills || '[]');
      for (const id of ids) {
        const key = JSON.stringify([row.id, id]);
        if (seen.has(key)) continue;
        seen.add(key);
        const stat = out[id] ??= { completed: 0, failed: 0, total: 0, successRate: 0 };
        if (row.status === 'completed') stat.completed++; else stat.failed++;
        stat.total++;
        stat.successRate = stat.completed / stat.total;
      }
    }
    return out;
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
      (id, kind, content, valid_from, valid_until, superseded_by, related_ids, uses, good, bad, demoted, created_at, updated_at, sources, relations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.kind, item.content, item.validFrom, item.validUntil ?? null,
      item.supersededBy ?? null, item.relatedIds ? JSON.stringify(item.relatedIds) : null,
      item.uses, item.good, item.bad, item.demoted ? 1 : 0, item.createdAt, item.updatedAt,
      JSON.stringify(item.sources || []), JSON.stringify(item.relations || []));
  }

  saveMemoryItems(items: MemoryItem[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try { for (const item of items) this.saveMemoryItem(item); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
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
      sources: row.sources ? JSON.parse(row.sources) : [],
      relations: row.relations ? JSON.parse(row.relations) : [],
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

  // ---- Chat: channels & messages ----

  private rowToChannel(row: any): Channel {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as ChannelKind,
      topic: row.topic ?? undefined,
      agentId: row.agent_id ?? undefined,
      createdAt: row.created_at,
    };
  }

  private rowToMessage(row: any): ChannelMessage {
    return {
      id: row.id,
      channelId: row.channel_id,
      authorKind: row.author_kind,
      authorId: row.author_id,
      authorName: row.author_name,
      body: row.body,
      status: row.status,
      executionId: row.execution_id ?? undefined,
      parentId: row.parent_id ?? undefined,
      replyCount: row.reply_count !== undefined ? Number(row.reply_count) : undefined,
      meta: row.meta ? JSON.parse(row.meta) : undefined,
      createdAt: row.created_at,
    };
  }

  /** Idempotent: creates #geral (all agents as members) and #approvals. */
  ensureDefaultChannels(): void {
    const now = new Date().toISOString();
    const has = (name: string) =>
      this.db.prepare('SELECT id FROM channels WHERE name = ?').get(name) != null;
    if (!has('geral')) {
      const id = randomUUID();
      this.db.prepare('INSERT INTO channels (id, name, kind, created_at) VALUES (?, ?, ?, ?)')
        .run(id, 'geral', 'channel', now);
      for (const a of this.getAllAgents()) {
        this.db.prepare('INSERT OR IGNORE INTO channel_agents (channel_id, agent_id) VALUES (?, ?)')
          .run(id, a.id);
      }
    }
    if (!has('approvals')) {
      this.db.prepare('INSERT INTO channels (id, name, kind, created_at) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), 'approvals', 'channel', now);
    }
  }

  listChannels(userId?: string): ChatChannelView[] {
    const rows = this.db.prepare('SELECT * FROM channels ORDER BY created_at').all() as any[];
    const agentsById = new Map(this.getAllAgents().map((a) => [a.id, a]));
    return rows.map((row) => {
      const ch = this.rowToChannel(row);
      const memberRows = this.db.prepare('SELECT agent_id FROM channel_agents WHERE channel_id = ?').all(ch.id) as any[];
      const agents = memberRows
        .map((r) => agentsById.get(r.agent_id))
        .filter((a): a is Agent => !!a)
        .map((a) => ({ id: a.id, name: a.name, avatar: a.avatar ?? null }));
      let unread = 0;
      if (userId) {
        const state = this.db.prepare('SELECT last_read_at FROM channel_user_state WHERE channel_id = ? AND user_id = ?')
          .get(ch.id, userId) as any;
        const since = state?.last_read_at ?? '1970-01-01';
        const row = this.db.prepare(
          "SELECT COUNT(*) AS c FROM messages WHERE channel_id = ? AND created_at > ? AND author_id != ?"
        ).get(ch.id, since, userId) as any;
        unread = row?.c ?? 0;
      }
      return { ...ch, agents, unread };
    }).sort((a, b) => {
      const rank = (c: ChatChannelView) =>
        c.name === 'geral' ? 0 : c.name === 'approvals' ? 1 : c.kind === 'dm' ? 3 : 2;
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }

  getChannel(id: string): Channel | null {
    const row = this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as any;
    return row ? this.rowToChannel(row) : null;
  }

  createChannel(input: { name: string; kind?: ChannelKind; agentId?: string; topic?: string; agentIds?: string[] }): Channel {
    const ch: Channel = {
      id: randomUUID(),
      name: input.name,
      kind: input.kind ?? 'channel',
      topic: input.topic,
      agentId: input.agentId,
      createdAt: new Date().toISOString(),
    };
    this.db.prepare('INSERT INTO channels (id, name, kind, topic, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ch.id, ch.name, ch.kind, ch.topic ?? null, ch.agentId ?? null, ch.createdAt);
    for (const agentId of input.agentIds ?? []) this.addChannelAgent(ch.id, agentId);
    return ch;
  }

  renameChannel(id: string, name: string): Channel | null {
    this.db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(name, id);
    return this.getChannel(id);
  }

  deleteChannel(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE channel_id = ?').run(id);
    this.db.prepare('DELETE FROM channel_agents WHERE channel_id = ?').run(id);
    this.db.prepare('DELETE FROM channel_user_state WHERE channel_id = ?').run(id);
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  }

  addChannelAgent(channelId: string, agentId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO channel_agents (channel_id, agent_id) VALUES (?, ?)').run(channelId, agentId);
  }

  removeChannelAgent(channelId: string, agentId: string): void {
    this.db.prepare('DELETE FROM channel_agents WHERE channel_id = ? AND agent_id = ?').run(channelId, agentId);
  }

  findDmChannel(agentId: string): Channel | null {
    const row = this.db.prepare("SELECT * FROM channels WHERE kind = 'dm' AND agent_id = ?").get(agentId) as any;
    return row ? this.rowToChannel(row) : null;
  }

  getMessages(channelId: string, opts?: { limit?: number; before?: string }): ChannelMessage[] {
    const limit = opts?.limit ?? 100;
    const cols = 'm.*, (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id) AS reply_count';
    let rows: any[];
    if (opts?.before) {
      const cursor = this.db.prepare('SELECT created_at, rowid FROM messages WHERE id = ?').get(opts.before) as any;
      if (!cursor) return [];
      rows = this.db.prepare(
        `SELECT ${cols} FROM messages m WHERE m.channel_id = ? AND m.parent_id IS NULL AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < ?)) ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`
      ).all(channelId, cursor.created_at, cursor.created_at, cursor.rowid, limit) as any[];
      rows.reverse();
    } else {
      rows = this.db.prepare(
        `SELECT ${cols} FROM messages m WHERE m.channel_id = ? AND m.parent_id IS NULL ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`
      ).all(channelId, limit) as any[];
      rows.reverse();
    }
    return rows.map((r) => this.rowToMessage(r));
  }

  /** All replies inside a thread, oldest first. */
  getThreadMessages(parentId: string, limit = 100): ChannelMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?'
    ).all(parentId, limit) as any[];
    return rows.map((r) => this.rowToMessage(r));
  }

  saveMessage(msg: Omit<ChannelMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): ChannelMessage {
    const full: ChannelMessage = {
      ...msg,
      id: msg.id ?? randomUUID(),
      createdAt: msg.createdAt ?? new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO messages (id, channel_id, author_kind, author_id, author_name, body, status, execution_id, parent_id, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id, full.channelId, full.authorKind, full.authorId, full.authorName,
      full.body, full.status, full.executionId ?? null, full.parentId ?? null,
      full.meta ? JSON.stringify(full.meta) : null, full.createdAt
    );
    return full;
  }

  getMessage(id: string): ChannelMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
    return row ? this.rowToMessage(row) : null;
  }

  updateMessage(id: string, patch: Partial<Pick<ChannelMessage, 'body' | 'status' | 'meta' | 'executionId'>>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.body !== undefined) { sets.push('body = ?'); params.push(patch.body); }
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.meta !== undefined) { sets.push('meta = ?'); params.push(JSON.stringify(patch.meta)); }
    if (patch.executionId !== undefined) { sets.push('execution_id = ?'); params.push(patch.executionId); }
    if (!sets.length) return;
    params.push(id);
    this.db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...params as any[]);
  }

  markChannelRead(channelId: string, userId: string): void {
    this.db.prepare(`
      INSERT INTO channel_user_state (channel_id, user_id, last_read_at) VALUES (?, ?, ?)
      ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at
    `).run(channelId, userId, new Date().toISOString());
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

