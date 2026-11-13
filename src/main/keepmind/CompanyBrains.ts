import { isAbsolute } from 'node:path';
import { statSync } from 'node:fs';
import type { CompanyBrainBinding } from '../../shared/company-brain.js';
import { createCompanyKeepMind } from './sidecar';
import type { KeepMindService } from './service';
import { clientIdFor } from './map';
export class RequiredCompanyBrainError extends Error {
  constructor() { super('The company memory connection is unavailable. Reconnect it before running this request.'); this.name = 'RequiredCompanyBrainError'; }
}
interface Settings { getSetting(key: string): string | null | undefined; setSetting(key: string, value: string): void }
export class CompanyBrains {
  private services = new Map<string, KeepMindService>();
  constructor(private settings: Settings, private factory = createCompanyKeepMind) {}
  list(): CompanyBrainBinding[] { return JSON.parse(this.settings.getSetting('companyBrain.bindings') || '[]'); }
  binding(agentId?: string) { return this.list().find(binding => binding.agentId === agentId); }
  save(binding: CompanyBrainBinding) {
    if (!binding || typeof binding.agentId !== 'string' || !binding.agentId) throw new Error('Agent required');
    clientIdFor(binding.companyId);
    for (const field of ['dataRoot', 'entry', 'node'] as const) if (typeof binding[field] !== 'string' || !isAbsolute(binding[field])) throw new Error('Absolute local paths required');
    if (!statSync(binding.dataRoot).isDirectory() || !statSync(binding.entry).isFile() || !statSync(binding.node).isFile()) throw new Error('Company memory paths unavailable');
    const clean = { agentId: binding.agentId, companyId: binding.companyId, dataRoot: binding.dataRoot, entry: binding.entry, node: binding.node };
    const bindings = this.list().filter(b => b.agentId !== clean.agentId);
    bindings.push(clean);
    this.services.get(clean.agentId)?.dispose(); this.services.delete(clean.agentId);
    this.settings.setSetting('companyBrain.bindings', JSON.stringify(bindings));
    return clean;
  }
  remove(agentId: string) {
    this.services.get(agentId)?.dispose(); this.services.delete(agentId);
    this.settings.setSetting('companyBrain.bindings', JSON.stringify(this.list().filter(b => b.agentId !== agentId)));
  }
  private service(agentId: string): KeepMindService | undefined {
    const binding = this.binding(agentId);
    if (!binding) return;
    let service = this.services.get(agentId);
    if (!service) {
      service = this.factory(binding.dataRoot, { companyId: binding.companyId }, { entry: binding.entry, node: binding.node });
      this.services.set(agentId, service);
    }
    return service;
  }
  async health(agentId: string) {
    if (!this.binding(agentId)) return false;
    try { await this.service(agentId)!.health(); return true; } catch { this.services.get(agentId)?.dispose(); this.services.delete(agentId); throw new RequiredCompanyBrainError(); }
  }
  async search(agentId: string, query: string) {
    try { const service = this.service(agentId); return service ? JSON.stringify(await service.search(query)) : ''; }
    catch { this.services.get(agentId)?.dispose(); this.services.delete(agentId); throw new RequiredCompanyBrainError(); }
  }
  stop() { for (const service of this.services.values()) service.dispose(); this.services.clear(); }
}
