import { z } from 'zod';
export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(4000),
  metric: z.string().trim().max(1000).default(''),
  voice: z.string().trim().max(2000).default(''),
  guardrails: z.string().trim().max(4000).default(''),
  teamId: z.string().min(1).optional(),
  teamTemplate: z.enum(['consulting','marketing','operations','general']).optional(),
  provider: z.enum(['openai','anthropic']).default('openai'),
  reportDaily: z.boolean().default(false),
  reportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  language: z.enum(['pt','en']).default('pt'),
}).strict().refine(v=>Boolean(v.teamId)!==Boolean(v.teamTemplate),{message:'Choose an existing team or a team template'});
export type ProjectInput = z.input<typeof projectInputSchema>;
export interface Project {
  access?: ProjectAccess;
  id: string; name: string; objective: string; metric: string; voice: string; guardrails: string;
  teamId: string; agentIds: string[]; skillIds: string[]; createdAt: string;
  reportDaily: boolean; reportTime: string; language: 'pt'|'en'; triggerId?: string;
}
export function pageItems<T>(items: T[], page: number, size = 12) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.max(1, Math.min(pages, Math.floor(page) || 1));
  return { items: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length };
}

export const projectPolicySchema=z.object({
  connectionIds:z.array(z.string().uuid()).max(30).default([]),
  skillIds:z.array(z.string()).max(100).default([]),
  voice:z.string().max(2000).default(''),guardrails:z.string().max(4000).default(''),
}).strict();
export type ProjectPolicy=z.infer<typeof projectPolicySchema>;
export interface CompanyStandard extends ProjectPolicy { id:string;name:string; }
export interface ConnectionInstance { id:string;name:string;kind:'gmail'|'outlook'|'whatsapp'|'secondbrain'; }
export interface ProjectAccess { companyId?:string; inheritConnections:boolean; inheritSkills:boolean; policy:ProjectPolicy; }

export const projectAccessPatchSchema=z.object({companyId:z.string().uuid().nullable().optional(),inheritConnections:z.boolean().optional(),inheritSkills:z.boolean().optional(),policy:projectPolicySchema.partial().optional()}).strict();
export function patchProjectAccess(current:ProjectAccess|undefined,raw:unknown):ProjectAccess {
 const patch=projectAccessPatchSchema.parse(raw);const base=current||{inheritConnections:false,inheritSkills:false,policy:{connectionIds:[],skillIds:[],voice:'',guardrails:''}};
 return {...base,...patch,companyId:patch.companyId===null?undefined:patch.companyId===undefined?base.companyId:patch.companyId,policy:{...base.policy,...patch.policy}};
}
