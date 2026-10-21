import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
try {
 writeFileSync('.env.keys',`API_OFFLINE_PRIVATE_KEY=${privateKey.export({type:'pkcs8',format:'der'}).toString('base64')}\n`,{flag:'wx',mode:0o600});
 console.log('Clave privada creada en .env.keys (excluida de Git). No reemplazarla sin plan de rotación.');
 console.log(`EXPO_PUBLIC_OFFLINE_PUBLIC_KEY=${publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex')}`);
} catch { console.error('No se creó la clave: .env.keys ya existe o no se puede escribir. No se sobrescribe.');process.exitCode=1; }
