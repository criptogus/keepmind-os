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
