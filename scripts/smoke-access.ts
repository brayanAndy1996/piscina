import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { generateKeyPairSync,randomUUID } from 'node:crypto';
import { readTestConfig } from '../apps/api/test-support/config.js';
import { createDatabase } from '../apps/api/src/database.js';
import { migrateAccess } from '../apps/api/src/access/migrations.js';
import { AccessService } from '../apps/api/src/access/service.js';

async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Sin puerto de prueba.');const result=address.port;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return result;}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill();await Promise.race([exited,delay(5000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
async function waitFor(url:string,child:ChildProcess){for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('El servicio terminó antes de iniciar.');try{const response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(response.ok)return response;}catch{/* Esperar mientras arranca el servicio. */}await delay(200);}throw new Error('Tiempo de inicio agotado.');}
async function main(){
 const config=readTestConfig(),admin=createDatabase(config);
 const name='piscina_web_test_'+randomUUID().replaceAll('-','');assert.match(name,/^piscina_web_test_[a-f0-9]{32}$/);
 await admin.query(`CREATE DATABASE "${name}"`);
 const url=new URL(config.databaseUrl);url.pathname='/'+name;
 const db=createDatabase({...config,databaseUrl:url.toString()});
 const key=generateKeyPairSync('ed25519').privateKey;
 let api:ChildProcess|undefined,web:ChildProcess|undefined;
 try{
  await migrateAccess(db);
  const service=new AccessService(db,key);
  await service.bootstrap({slug:'web-prueba',name:'Academia web ficticia',username:'admin',displayName:'Propietario',password:'WebPrueba2026!'});
  const apiPort=await port(),webPort=await port(),origin=`http://127.0.0.1:${webPort}`;
  const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',WEB_ORIGIN:origin,API_DATABASE_URL:url.toString(),API_HOST:'127.0.0.1',API_PORT:String(apiPort),API_URL:`http://127.0.0.1:${apiPort}`,API_DATABASE_SSL:'disable',API_OFFLINE_PRIVATE_KEY:key.export({type:'pkcs8',format:'der'}).toString('base64')};
  api=spawn(process.execPath,['apps/api/dist/main.js'],{env:{...env,NODE_ENV:'development'},stdio:'ignore'});
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','--port',String(webPort),'--hostname','127.0.0.1'],{env:{...env,NODE_ENV:'production'},stdio:'ignore'});
  await waitFor(env.API_URL+'/health/live',api);await waitFor(origin,web);
  const loginBody={academy:'web-prueba',username:'admin',password:'WebPrueba2026!'};
  const bad=await fetch(origin+'/api/access/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.example'},body:JSON.stringify(loginBody)});assert.equal(bad.status,403);
  const login=await fetch(origin+'/api/access/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(loginBody)});assert.equal(login.status,200,'login BFF de mismo origen');
  const rawCookie=login.headers.get('set-cookie')??'';
  assert.ok(rawCookie.includes('HttpOnly'),'Cookie debe ser HttpOnly');assert.ok(rawCookie.includes('SameSite=strict'),'Cookie debe ser SameSite Strict');assert.ok(rawCookie.includes('Secure'),'Cookie debe ser Secure en producción');
  const loginData:unknown=await login.json();assert.ok(loginData&&typeof loginData==='object'&&!Object.hasOwn(loginData,'token'),'El token no debe llegar al JavaScript del navegador.');
  const cookie=rawCookie.split(';')[0]!;
  const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
  const users=await fetch(origin+'/api/access/users',{headers});assert.equal(users.status,200);
  const list=await users.json() as {id:string;password_hash?:string}[];assert.equal(list.length,1);assert.ok(!list[0]?.password_hash);
  const created=await fetch(origin+'/api/access/users',{method:'POST',headers,body:JSON.stringify({username:'recepcion',displayName:'Recepción',role:'SECRETARIA',password:'TemporalWeb2026!'})});assert.equal(created.status,201);
  const csrf=await fetch(origin+'/api/access/users',{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:JSON.stringify({})});assert.equal(csrf.status,403);
  const page=await fetch(origin+'/acceso');assert.equal(page.status,200);assert.ok((await page.text()).includes('Iniciar sesión'));
  const logout=await fetch(origin+'/api/access/auth/logout',{method:'POST',headers});assert.equal(logout.status,200);
  assert.equal((await fetch(origin+'/api/access/auth/me',{headers})).status,401);
  const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
  try {
   const context=await browser.newContext();const screen=await context.newPage();
   await screen.goto(origin+'/acceso');
   await screen.getByLabel('Academia',{exact:true}).fill('web-prueba');
   await screen.getByLabel('Usuario',{exact:true}).fill('admin');
   await screen.getByLabel('Contraseña',{exact:true}).fill('WebPrueba2026!');
   await screen.getByRole('button',{name:'Entrar',exact:true}).click();
   await screen.getByRole('heading',{name:'Propietario',exact:true}).waitFor();
   assert.ok(!(await screen.evaluate(()=>document.cookie)).includes('piscina_session'));
   assert.equal(await screen.evaluate(()=>localStorage.length),0);
   const form=screen.locator('form').filter({has:screen.getByRole('button',{name:'Crear usuario',exact:true})});
   await form.getByLabel('Usuario',{exact:true}).fill('browser-user');
   await form.getByLabel('Nombre',{exact:true}).fill('Usuario navegador');
   await form.locator('select[name=role]').selectOption('SECRETARIA');
   await form.getByLabel('Contraseña temporal',{exact:true}).fill('BrowserPrueba2026!');
   await form.getByRole('button',{name:'Crear usuario',exact:true}).click();
   await screen.getByRole('heading',{name:'browser-user',exact:true}).waitFor();
   await screen.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
   await screen.getByRole('button',{name:'Entrar',exact:true}).waitFor();
   await context.close();
  }finally{await browser.close();}
  const oldSession=await service.login({academy:'web-prueba',username:'admin',password:'WebPrueba2026!'});
  const recovered=spawnSync(process.execPath,['--import','tsx','apps/api/src/access/cli.ts','recover'],{env:{...env,NODE_ENV:'development',BOOTSTRAP_ACADEMY:'web-prueba',BOOTSTRAP_USERNAME:'admin',BOOTSTRAP_PASSWORD:'RecuperadaWeb2026!'},stdio:'pipe',timeout:15000});
  assert.equal(recovered.status,0,'CLI de recuperación debe completar');
  await assert.rejects(service.actor(oldSession.token),{code:'UNAUTHENTICATED'});
  assert.equal((await service.login({academy:'web-prueba',username:'admin',password:'RecuperadaWeb2026!'})).user.role,'ADMIN');
  console.log('Smoke correcto: login/alta/logout en navegador, cookies/CSRF, aislamiento de token y recuperación CLI auditada.');
 }finally{
  await Promise.all([api?stop(api):Promise.resolve(),web?stop(web):Promise.resolve()]);await db.close();await admin.query(`DROP DATABASE "${name}"`);await admin.close();
 }
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Falló el smoke de acceso.');process.exitCode=1;});
