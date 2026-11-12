import type { AgentTrigger } from '../../shared/types.js';
import { v4 as uuidv4 } from 'uuid';

const TICK_MS = 30_000;
const SETTINGS_KEY = 'triggers.rules';
const WHATSAPP_AGENT_KEY = 'trigger.whatsappAgentId';
const WA_QUEUE_KEY = 'whatsapp.retryQueue';

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

  /**
   * Called when a WhatsApp message arrives; runs the configured agent.
   * If the run fails (e.g. LLM offline), the message is queued and retried
   * on the next connection or incoming message — nothing is lost offline.
   */
  async onWhatsAppMessage(from: string, text: string): Promise<void> {
    const agentId = this.getWhatsAppAgentId();
    if (!agentId || !this.ctx) return;
    const ok = await this.tryRun(agentId, {
      channel: 'whatsapp',
      from,
      message: text,
      task: `Respond to this WhatsApp message from ${from}: "${text}". Keep the reply concise and send it back via the whatsapp_send_message tool if a reply is appropriate.`,
    }, `whatsapp:${from}`);
    if (!ok) {
      this.loadWaQueue();
      this.waQueue.push({ from, text, at: Date.now() });
      this.saveWaQueue();
    }
  }

  /** Retries WhatsApp replies that failed while the LLM was unreachable. */
  async retryWhatsAppQueue(): Promise<void> {
    this.loadWaQueue();
    if (!this.waQueue.length || !this.ctx) return;
    const agentId = this.getWhatsAppAgentId();
    if (!agentId) { this.waQueue = []; this.saveWaQueue(); return; }
    const pending = this.waQueue;
    this.waQueue = [];
    this.saveWaQueue();
    for (const item of pending) {
      const ok = await this.tryRun(agentId, {
        channel: 'whatsapp',
        from: item.from,
        message: item.text,
        task: `Respond to this WhatsApp message from ${item.from}: "${item.text}". Keep the reply concise and send it back via the whatsapp_send_message tool if a reply is appropriate. (This is a queued retry — the original message may be old.)`,
      }, `whatsapp-retry:${item.from}`);
      if (!ok) {
        // LLM still down — keep the rest queued for the next attempt.
        this.waQueue = [item, ...pending.slice(pending.indexOf(item) + 1), ...this.waQueue];
        this.saveWaQueue();
        return;
      }
    }
  }

  private waQueue: Array<{ from: string; text: string; at: number }> = [];

  private loadWaQueue(): void {
    try {
      this.waQueue = JSON.parse(this.getSetting(WA_QUEUE_KEY) || '[]');
    } catch {
      this.waQueue = [];
    }
  }

  private saveWaQueue(): void {
    this.setSetting(WA_QUEUE_KEY, JSON.stringify(this.waQueue.slice(-50)));
  }

  /**
   * Event-driven entry point: the local webhook server calls this when a
   * POST arrives with a trigger's token. Returns false for unknown tokens
   * or disabled rules — the HTTP layer maps that to 404.
   */
  async dispatchWebhook(token: string, payload: unknown): Promise<boolean> {
    this.load();
    const rule = this.rules.find((r) => r.enabled && r.kind === 'webhook' && r.webhookToken === token);
    if (!rule || !this.ctx) return false;
    rule.lastRunAt = new Date().toISOString();
    this.save();
    await this.fire(rule.agentId, {
      channel: 'webhook',
      triggerId: rule.id,
      task: rule.prompt,
      webhookPayload: payload,
    }, `webhook:${rule.id}`);
    return true;
  }

  private async tryRun(agentId: string, input: Record<string, unknown>, source: string): Promise<boolean> {
    if (!this.ctx) return true;
    if (!this.ctx.getAgentName(agentId)) return true; // agent deleted — nothing to retry
    try {
      await this.ctx.runAgent(agentId, input);
      return true;
    } catch (error) {
      console.error(`[triggers] ${source} run failed:`, error);
      return false;
    }
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
    if (rule.kind === 'webhook') return false; // event-driven, never polled
    if (rule.kind === 'interval') {
      const minutes = rule.intervalMinutes ?? 60;
      if (minutes < 1) return false;
      if (!rule.lastRunAt) return true;
      return now.getTime() - new Date(rule.lastRunAt).getTime() >= minutes * 60_000;
    }
    // daily at HH:MM local; fires once per day after that time.
    // daysOfWeek (0=Sun..6=Sat) restricts which days it may fire on.
    const days = rule.daysOfWeek?.filter((d) => d >= 0 && d <= 6);
    if (days && days.length > 0 && !days.includes(now.getDay())) return false;
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
