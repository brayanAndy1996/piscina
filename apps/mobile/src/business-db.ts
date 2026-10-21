import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {bytesToHex} from '@noble/curves/utils.js';
import {BusinessStore,type SqlStore} from '../../../contracts/business-store';
const stores=new Map<string,Promise<BusinessStore>>();
export function businessStore(tenant:string){
 if(!/^[a-f0-9-]{36}$/.test(tenant))throw new Error('Academia inválida.');
 let store=stores.get(tenant);if(!store){store=(async()=>{
  const name='piscina.business.key.'+tenant,options={keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY};let key=await SecureStore.getItemAsync(name,options);
  if(!key){key=bytesToHex(await Crypto.getRandomBytesAsync(32));await SecureStore.setItemAsync(name,key,options);}if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Clave local inválida. Conserva el almacenamiento.');
  const filename='business-'+tenant+'.db',unlock=`PRAGMA key = "x'${key}'";`,db=await SQLite.openDatabaseAsync(filename);
  await db.execAsync(unlock);
  const cipher=await db.getFirstAsync<Record<string,unknown>>('PRAGMA cipher_version');if(!cipher||!Object.values(cipher).some(v=>typeof v==='string'&&v.length>0)){await db.closeAsync();throw new Error('Se necesita la compilación Android con SQLCipher; Expo Go no habilita negocio offline.');}
  await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  // Expo's exclusive helper opens a fresh connection without applying the SQLCipher key.
  // Unlock our dedicated transaction connection BEFORE BEGIN or any schema access.
  const adapter:SqlStore={execAsync:sql=>db.execAsync(sql),runAsync:(sql,...args)=>db.runAsync(sql,...args),getFirstAsync:<T>(sql:string,...args:(string|number|null)[])=>db.getFirstAsync<T>(sql,...args),getAllAsync:<T>(sql:string,...args:(string|number|null)[])=>db.getAllAsync<T>(sql,...args),withExclusiveTransactionAsync:async fn=>{
   const tx=await SQLite.openDatabaseAsync(filename,{useNewConnection:true});try{await tx.execAsync(unlock);await tx.execAsync('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');try{await fn(tx);await tx.execAsync('COMMIT');}catch(error){try{await tx.execAsync('ROLLBACK');}catch{/* Preserve original failure. */}throw error;}}finally{await tx.closeAsync();}
  }};const result=new BusinessStore(adapter);await result.initialize();return result;
 })();stores.set(tenant,store);store.catch(()=>stores.delete(tenant));}return store;
}
