import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export const header=Buffer.from('PISCINA_BACKUP_V1\n');
export function backupKey(value:string|undefined){if(!value||! /^[a-f0-9]{64}$/i.test(value))throw new Error('Configura BACKUP_ENCRYPTION_KEY con 32 bytes hexadecimales.');return Buffer.from(value,'hex');}
export function encryptBackup(source:Buffer,key:Buffer){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([header,iv,cipher.update(source),cipher.final(),cipher.getAuthTag()]);}
export function decryptBackup(source:Buffer,key:Buffer){if(source.length<header.length+28||!source.subarray(0,header.length).equals(header))throw new Error('Formato de respaldo inválido.');const start=header.length,decipher=createDecipheriv('aes-256-gcm',key,source.subarray(start,start+12));decipher.setAuthTag(source.subarray(-16));return Buffer.concat([decipher.update(source.subarray(start+12,-16)),decipher.final()]);}
