import { it,expect } from 'vitest';
import path from 'node:path';
import { McpManager } from '../src/main/mcp/McpManager';
import { ToolRegistry } from '../src/main/tools/registry';
it('negotiates a real stdio MCP server, discovers tools, calls through governance and cleans up',async()=>{
  const registry=new ToolRegistry();const mcp=new McpManager(registry);
  try{
    const statuses=await mcp.configure([{id:'fixture',transport:'stdio',command:process.execPath,args:[path.resolve('test/fixtures/mcp-server.mjs')],enabled:true}]);
    expect(statuses[0].connected).toBe(true);const name=statuses[0].tools[0];expect(name).toMatch(/^mcp_fixture_echo_/);
    let gates=0;registry.setGate(async()=>{gates++;return 'Denied';});expect(await registry.execute(name,{text:'hello'},{allowedTools:[name]})).toBe('Denied');expect(gates).toBe(1);
    registry.setGate(async()=>null);expect(await registry.execute(name,{text:'hello'},{allowedTools:[name]})).toContain('hello');
    await expect(registry.execute(name,{text:'hello'},{allowedTools:[]})).rejects.toThrow('not authorized');
    await mcp.close();expect(registry.get(name)).toBeUndefined();
  }finally{await mcp.close();}
},20000);
it('keeps disabled servers stopped and reports invalid commands without exposing environment values',async()=>{
 const registry=new ToolRegistry();const mcp=new McpManager(registry);
 try{expect((await mcp.configure([{id:'disabled',transport:'stdio',command:'/no/such/executable',enabled:false}]))[0].connected).toBe(false);
 const status=(await mcp.configure([{id:'bad',transport:'stdio',command:'relative',enabled:true}]))[0];expect(status.connected).toBe(false);expect(status.tools).toEqual([]);
 }finally{await mcp.close();}
});
