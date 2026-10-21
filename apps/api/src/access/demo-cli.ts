import {seedAcademyDemo} from '../academy/demo.js';
import { readConfig } from '../config.js';
import { createDatabase } from '../database.js';
import { AccessService } from './service.js';
import { signingKey } from './crypto.js';
import { seedAccessDemo } from './demo.js';
import { AccessError } from './policy.js';
async function main(){const db=createDatabase(readConfig());try{const service=new AccessService(db,signingKey(process.env.API_OFFLINE_PRIVATE_KEY??''));const enabled=process.argv.includes('--demo');await seedAccessDemo(service,enabled);await seedAcademyDemo(service,enabled,process.env.DEMO_BASE_DATE??'2026-10-01');console.log('Demo de acceso y academia preparada; registros existentes conservados.');}finally{await db.close();}}
main().catch((error:unknown)=>{console.error(error instanceof AccessError?error.message:'No se cargó la demo; revise destino, configuración y migraciones.');process.exitCode=1;});
