import { readConfig } from '../config.js';
import { createDatabase } from '../database.js';
import { AccessService } from './service.js';
import { signingKey } from './crypto.js';
import { seedAccessDemo } from './demo.js';
import { AccessError } from './policy.js';
async function main(){const db=createDatabase(readConfig());try{await seedAccessDemo(new AccessService(db,signingKey(process.env.API_OFFLINE_PRIVATE_KEY??'')),process.argv.includes('--demo'));console.log('Demo de acceso preparada; registros existentes conservados.');}finally{await db.close();}}
main().catch((error:unknown)=>{console.error(error instanceof AccessError?error.message:'No se cargó la demo; revise destino, configuración y migraciones.');process.exitCode=1;});
