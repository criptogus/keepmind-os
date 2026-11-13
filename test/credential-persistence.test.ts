import { expect, it, vi } from 'vitest';
const encryption = vi.hoisted(()=>({encrypt:vi.fn(async(value:string)=>Buffer.from(value))}));
vi.mock('electron',()=>({safeStorage:{isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:encryption.encrypt}}));
import { CredentialStore } from '../src/main/auth/CredentialStore';
it('exposes a newly issued token immediately and prevents an async write from restoring disconnected credentials',async()=>{
  let finish!:(value:Buffer<ArrayBuffer>)=>void;encryption.encrypt.mockImplementationOnce(()=>new Promise<Buffer<ArrayBuffer>>(r=>{finish=r;}));
  const db=new Map<string,string>();const store=new CredentialStore({getSetting:k=>db.get(k),setSetting:(k,v)=>{db.set(k,v);},getAllSettings:()=>({})});await store.warm();
  store.setSecret('sak','fixture-token');expect(store.getSecret('sak')).toBe('fixture-token');
  await vi.waitFor(()=>expect(encryption.encrypt).toHaveBeenCalled());store.clearSecret('sak');finish(Buffer.from('ciphertext'));await new Promise(r=>setTimeout(r,0));
  expect(store.getSecret('sak')).toBeNull();expect(db.get('cred.secret.sak')).toBe('');
});
it('waits for durable encryption and reports persistence failure rather than false success',async()=>{
 const db=new Map<string,string>();const store=new CredentialStore({getSetting:k=>db.get(k),setSetting:(k,v)=>{db.set(k,v);},getAllSettings:()=>({})});await store.warm();
 let complete!:(value:Buffer<ArrayBuffer>)=>void;encryption.encrypt.mockImplementationOnce(()=>new Promise<Buffer<ArrayBuffer>>(resolve=>{complete=resolve;}));
 store.setApiKey('openai','fixture-key');let flushed=false;const pending=store.flush().then(()=>{flushed=true;});
 await vi.waitFor(()=>expect(complete).toBeDefined());expect(flushed).toBe(false);complete(Buffer.from('ciphertext'));await pending;expect(db.get('cred.apikey.openai')).toBeTruthy();
 encryption.encrypt.mockRejectedValueOnce(new Error('Keychain unavailable'));store.setApiKey('openai','replacement');await expect(store.flush()).rejects.toThrow('persist credentials');
 store.clearApiKey('openai');await expect(store.flush()).resolves.toBeUndefined();
});
it('restores saved provider OAuth after a fresh credential-store instance',async()=>{
 const db=new Map<string,string>();const storage={getSetting:(k:string)=>db.get(k),setSetting:(k:string,v:string)=>{db.set(k,v);},getAllSettings:()=>Object.fromEntries(db)};
 const {safeStorage}=await import('electron');Object.assign(safeStorage,{decryptStringAsync:async(value:Buffer)=>({result:value.toString()})});
 const original=new CredentialStore(storage);await original.warm();original.setOAuth('openai',{accessToken:'fixture-access',refreshToken:'fixture-refresh',tokenType:'Bearer',expiresAt:Date.now()+60000});await original.flush();
 const restored=new CredentialStore(storage);await restored.warm();expect(restored.getOAuth('openai')?.accessToken).toBe('fixture-access');expect(restored.getOAuth('openai')?.refreshToken).toBe('fixture-refresh');
});
