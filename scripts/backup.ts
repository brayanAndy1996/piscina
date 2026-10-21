import {spawn} from 'node:child_process';
import {mkdir,open,readFile,writeFile,mkdtemp,rm,stat} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {backupKey,encryptBackup,decryptBackup} from '../apps/api/src/operations/backup-crypto.js';
import {readConfig} from '../apps/api/src/config.js';
import {readTestConfig} from '../apps/api/test-support/config.js';
import {createDatabase} from '../apps/api/src/database.js';
function pgEnvironment(urlText:string,ssl:boolean){const url=new URL(urlText);return {...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:ssl?'verify-full':'disable'};}
async function pg(name:string,args:string[],env:NodeJS.ProcessEnv){const bin=process.env.PG_BIN?.trim(),executable=bin?join(bin,name+(process.platform==='win32'?'.exe':'')):name;await new Promise<void>((done,reject)=>{const child=spawn(executable,args,{env,stdio:['ignore','ignore','pipe'],windowsHide:true});child.on('error',()=>reject(new Error('No se encuentra herramienta PostgreSQL; configura PG_BIN.')));child.on('exit',code=>code===0?done():reject(new Error('La herramienta PostgreSQL no completó la operación; no se imprimen credenciales ni SQL.')));child.stderr.resume();});}
async function main(){
 const command=process.argv[2];if(command==='key'){const file=await open('.env.backup','wx',0o600);try{await file.writeFile('BACKUP_ENCRYPTION_KEY='+randomBytes(32).toString('hex')+'\n');}finally{await file.close();}console.log('Clave creada en .env.backup sin sobrescribir. Respaldarla separada de los archivos cifrados.');return;}
 const key=backupKey(process.env.BACKUP_ENCRYPTION_KEY),temp=await mkdtemp(join(tmpdir(),'piscina-backup-'));
 const root=resolve(tmpdir())+sep;if(!resolve(temp).startsWith(root)||!temp.includes('piscina-backup-'))throw new Error('Ruta temporal fuera de ámbito.');
 try{
  const dump=join(temp,'private.dump');
  if(command==='create'){
   const config=readConfig(),directory=resolve(process.env.BACKUP_DIRECTORY||'.backups');await mkdir(directory,{recursive:true});await writeFile(dump,'',{mode:0o600,flag:'wx'});await pg('pg_dump',['--format=custom','--no-owner','--no-privileges','--file',dump],pgEnvironment(config.databaseUrl,config.databaseSsl));
   const info=await stat(dump);if(info.size>512*1024*1024)throw new Error('Este comando admite respaldos de hasta 512 MB; usar pipeline de respaldo de hosting para más volumen.');const bytes=encryptBackup(await readFile(dump),key),target=join(directory,'piscina-'+Date.now()+'-'+randomUUID()+'.backup');await writeFile(target,bytes,{mode:0o600,flag:'wx'});console.log('Backup cifrado creado: '+target);return;
  }
  if(command==='verify'){
   const input=process.argv[3];if(!input)throw new Error('Indica archivo cifrado a verificar.');if((await stat(input)).size>512*1024*1024+100)throw new Error('Respaldo excede límite de verificación local.');const bytes=decryptBackup(await readFile(input),key);await writeFile(dump,bytes,{mode:0o600,flag:'wx'});
   const config=readTestConfig(),admin=createDatabase(config),name='piscina_restore_'+randomUUID().replaceAll('-','')+'_test';if(!/^piscina_restore_[a-f0-9]{32}_test$/.test(name))throw new Error('Nombre de fixture inválido.');let created=false;
   try{await admin.query(`CREATE DATABASE "${name}"`);created=true;const url=new URL(config.databaseUrl);url.pathname='/'+name;await pg('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--dbname',name,dump],pgEnvironment(url.toString(),false));const restored=createDatabase({...config,databaseUrl:url.toString()});try{const rows=await restored.query("SELECT version FROM piscina_migrations WHERE version IN ('001_access','002_academy','003_operations','004_sync')");if(!Array.isArray(rows[0])||rows[0].length<4)throw new Error('Respaldo no contiene las migraciones esperadas.');await restored.query('SELECT count(*) FROM academy_students');await restored.query('SELECT count(*) FROM academy_payments');await restored.query('SELECT count(*) FROM academy_sync_incidents');}finally{await restored.close();}console.log('Respaldo autenticado y restaurado en BD efímera aislada; eliminada al terminar.');}finally{if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.close();}return;
  }
  throw new Error('Usa key, create o verify.');
 }finally{await rm(temp,{recursive:true,force:true});}
}
main().catch((e:unknown)=>{console.error(e instanceof Error&&!(e.name.startsWith('Sequelize'))?e.message:'No se completó el respaldo o su verificación.');process.exitCode=1;});
