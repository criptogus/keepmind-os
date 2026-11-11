import type { AgentTrigger } from '../../shared/types.js';
import { v4 as uuidv4 } from 'uuid';

const TICK_MS = 30_000;
const SETTINGS_KEY = 'triggers.rules';
const WHATSAPP_AGENT_KEY = 'trigger.whatsappAgentId';

export interface TriggerRunContext {
  runAgent: (agentId: string, input: Record<string, unknown>) => Promise<unknown>;
  getAgentName: (agentId: string) => string | undefined;
}

/**
 * Schedules autonomous agent runs. Rules persist as JSON in the settings
 * table; a 30s tick checks for due triggers (interval or daily HH:MM).
 */
export class TriggerManager {
  private rules: AgentTrigger[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ctx?: TriggerRunContext;

  constructor(
    private getSetting: (key: string) => string | null | undefined,
    private setSetting: (key: string, value: string) => void
  ) {}

  attach(ctx: TriggerRunContext): void {
    this.ctx = ctx;
    this.load();
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private load(): void {
    try {
      const raw = this.getSetting(SETTINGS_KEY);
      this.rules = raw ? (JSON.parse(raw) as AgentTrigger[]) : [];
    } catch {
      this.rules = [];
    }
  }

  private save(): void {
    this.setSetting(SETTINGS_KEY, JSON.stringify(this.rules));
  }

  list(): AgentTrigger[] {
    this.load();
    return this.rules;
  }

  create(input: Omit<AgentTrigger, 'id' | 'createdAt' | 'lastRunAt'>): AgentTrigger {
    const rule: AgentTrigger = {
      ...input,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    this.rules.push(rule);
    this.save();
    return rule;
  }

  update(id: string, updates: Partial<Omit<AgentTrigger, 'id' | 'createdAt'>>): AgentTrigger | null {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return null;
    Object.assign(rule, updates);
    this.save();
    return rule;
  }

  delete(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    this.save();
    return this.rules.length !== before;
  }

  /** Agent that auto-responds to incoming WhatsApp messages ('' disables). */
  getWhatsAppAgentId(): string {
    return this.getSetting(WHATSAPP_AGENT_KEY) || '';
  }

  setWhatsAppAgentId(agentId: string): void {
    this.setSetting(WHATSAPP_AGENT_KEY, agentId);
  }

  /** Called when a WhatsApp message arrives; runs the configured agent. */
  async onWhatsAppMessage(from: string, text: string): Promise<void> {
    const agentId = this.getWhatsAppAgentId();
    if (!agentId || !this.ctx) return;
    await this.fire(agentId, {
      channel: 'whatsapp',
      from,
      message: text,
      task: `Respond to this WhatsApp message from ${from}: "${text}". Keep the reply concise and send it back via the whatsapp_send_message tool if a reply is appropriate.`,
    }, `whatsapp:${from}`);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      for (const rule of this.rules) {
        if (!rule.enabled || !this.ctx) continue;
        if (!this.isDue(rule, now)) continue;
        rule.lastRunAt = now.toISOString();
        this.save();
        await this.fire(
          rule.agentId,
          { channel: 'schedule', triggerId: rule.id, task: rule.prompt },
          `trigger:${rule.id}`
        );
      }
    } finally {
      this.running = false;
    }
  }

  private isDue(rule: AgentTrigger, now: Date): boolean {
    if (rule.kind === 'interval') {
      const minutes = rule.intervalMinutes ?? 60;
      if (minutes < 1) return false;
      if (!rule.lastRunAt) return true;
      return now.getTime() - new Date(rule.lastRunAt).getTime() >= minutes * 60_000;
    }
    // daily at HH:MM local; fires once per day after that time
    const [h, m] = (rule.timeOfDay || '09:00').split(':').map(Number);
    const dueToday = new Date(now);
    dueToday.setHours(h || 0, m || 0, 0, 0);
    if (now < dueToday) return false;
    if (!rule.lastRunAt) return true;
    return new Date(rule.lastRunAt) < dueToday;
  }

  private async fire(agentId: string, input: Record<string, unknown>, source: string): Promise<void> {
    if (!this.ctx) return;
    if (!this.ctx.getAgentName(agentId)) return; // agent deleted
    try {
      await this.ctx.runAgent(agentId, input);
    } catch (error) {
      console.error(`[triggers] ${source} run failed:`, error);
    }
  }
}
