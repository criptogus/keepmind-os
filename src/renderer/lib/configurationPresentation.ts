const enums: Record<string,Record<string,[string,string]>>={
 level:{workspace:['Somente pasta do espaço','Workspace folder only'],authorized:['Pastas e comandos autorizados','Authorized folders and commands'],full:['Acesso completo ao computador','Full computer access']},
 priority:{consulting:['Entregas','Delivery'],marketing:['Marketing','Marketing'],operations:['Operações','Operations'],general:['Apoio geral','General support']},
 theme:{light:['Claro','Light'],dark:['Escuro','Dark'],auto:['Automático','Automatic']},
 language:{pt:['Português','Portuguese'],en:['Inglês','English']},
 autonomy:{draft:['Preparar pedido; aguardar meu início','Prepare request; wait for me to start'],run:['Executar automaticamente','Run automatically']},
 kind:{interval:['Em intervalos','At intervals'],daily:['Diariamente','Daily'],webhook:['Ao receber um evento','On incoming event']},
 access:{read:['Somente leitura','Read only'],write:['Leitura e escrita','Read and write']},
};
export function formatConfigurationValue(key:string,value:unknown,language:'pt'|'en',names:Record<string,string>={}):string {
 if(key==='policy'&&value&&typeof value==='object'){const labels:Record<string,[string,string]>={connectionIds:['Contas','Accounts'],skillIds:['Habilidades','Skills'],voice:['Tom de voz','Voice'],guardrails:['Regras','Rules']};return Object.entries(value).map(([field,v])=>`${labels[field]?.[language==='pt'?0:1]||field}: ${formatConfigurationValue(field,v,language,names)||'—'}`).join('\n');}
 if(key==='roles'&&Array.isArray(value))return value.map(role=>`${role.name} — ${role.purpose}`).join('\n');
 if(['agentId','skillIds','id','teamId','companyId','connectionIds'].includes(key)){const name=(id:unknown)=>names[String(id)]?`${names[String(id)]} (${id})`:String(id);return Array.isArray(value)?value.map(name).join(', '):name(value);}
 if(typeof value==='boolean')return language==='pt'?(value?'Sim':'Não'):(value?'Yes':'No');
 if(typeof value==='string'&&enums[key]?.[value])return enums[key][value][language==='pt'?0:1];
 return Array.isArray(value)?value.join(', '):typeof value==='object'?JSON.stringify(value):String(value);
}
