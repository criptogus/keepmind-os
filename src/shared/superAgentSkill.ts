export interface SakStatus { connected: boolean; pending: boolean; authUrl?: string; error?: string; notice?: string; }
export interface SakHit { slug: string; name: string; description: string; version: string; }
export interface SakPreview extends SakHit { prompt: string; source: string; digest: string; }
