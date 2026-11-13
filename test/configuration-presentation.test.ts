import {expect,it} from 'vitest';
import {formatConfigurationValue as format} from '../src/renderer/lib/configurationPresentation';
it('localizes permission and autonomy enums without translating authored names or prompts',()=>{
 expect(format('autonomy','run','pt')).toBe('Executar automaticamente');expect(format('access','write','pt')).toBe('Leitura e escrita');
 for(const key of ['name','prompt','systemPrompt'])for(const value of ['light','dark','auto','pt','en'])expect(format(key,value,'pt')).toBe(value);
 expect(format('id','routine-1','pt',{'routine-1':'Resumo diário'})).toBe('Resumo diário (routine-1)');
});
