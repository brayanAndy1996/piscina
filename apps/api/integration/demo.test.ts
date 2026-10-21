import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID,generateKeyPairSync } from 'node:crypto';
import { readTestConfig } from '../test-support/config.js';
import { createDatabase } from '../src/database.js';
import { migrateAccess } from '../src/access/migrations.js';
import { AccessService } from '../src/access/service.js';
import { seedAccessDemo } from '../src/access/demo.js';

test('demo explícita, repetible y protegida frente a datos reales',async()=>{
 const config=readTestConfig(),admin=createDatabase(config);
 const name='piscina_access_test_'+randomUUID().replaceAll('-','')+'_demo';
 assert.match(name,/^piscina_access_test_[a-f0-9]{32}_demo$/);
 await admin.query(`CREATE DATABASE "${name}"`);
 const url=new URL(config.databaseUrl);url.pathname='/'+name;
 const db=createDatabase({...config,databaseUrl:url.toString()});
 const service=new AccessService(db,generateKeyPairSync('ed25519').privateKey);
 try {
  await migrateAccess(db);
  await assert.rejects(seedAccessDemo(service,false),{code:'DEMO_TARGET'});
  await seedAccessDemo(service,true);
  const before=await service.rows('SELECT id FROM access_users');assert.equal(before.length,8);
  await seedAccessDemo(service,true);
  assert.equal((await service.rows('SELECT id FROM access_users')).length,8);
  const adminLogin=await service.login({academy:'demo-azul',username:'admin',password:'DemoLocal2026!'});
  assert.equal((await service.users(adminLogin.token)).length,4);
  await assert.rejects(service.login({academy:'demo-azul',username:'inactivo',password:'InactivoDemo2026!'}),{code:'INVALID_CREDENTIALS'});
  await assert.rejects(service.bootstrap({slug:'normal',name:'Real',username:'admin',displayName:'Real',password:'UnaClaveReal2026!'}),{code:'DATABASE_MODE'});
  // Simular marcador de instalación normal dentro de esta BD de prueba demuestra rechazo, sin datos reales.
  await service.run("UPDATE access_tenants SET mode='normal' WHERE slug='demo-azul'");
  await assert.rejects(seedAccessDemo(service,true),{code:'REAL_DATA'});
 }finally{await db.close();await admin.query(`DROP DATABASE "${name}"`);await admin.close();}
});
