import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {AcademyService} from '../academy/service.js';
import {AccessError} from '../access/policy.js';
import {checked,object,id} from '../academy/validation.js';
export class PrivateFiles {
 constructor(readonly academy:AcademyService){}
 async upload(token:string,raw:unknown){const a=await this.academy.access.actor(token,'students.manage'),d=checked(()=>object(raw,['studentId','purpose','base64'])),sid=checked(()=>id(d.studentId));if(!['PHOTO','PROOF'].includes(String(d.purpose))||typeof d.base64!=='string'||d.base64.length>6990510||! /^[a-zA-Z0-9+/]*={0,2}$/.test(d.base64))throw new AccessError(400,'INVALID_IMAGE','Solo JPG/PNG de hasta 5 MB.');
  await this.academy.studentDetail(token,sid);const source=Buffer.from(d.base64,'base64');if(!source.length||source.length>5*1024*1024||!(source.subarray(0,3).equals(Buffer.from([255,216,255]))||source.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))throw new AccessError(400,'INVALID_IMAGE','Imagen JPG/PNG inválida.');let bytes:Buffer;
  try{bytes=await sharp(source,{limitInputPixels:20000000,animated:false}).rotate().resize(1280,1280,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();}catch{throw new AccessError(400,'INVALID_IMAGE','No se pudo decodificar la imagen o excede 20 MP.');}
  if(bytes.length>5*1024*1024)throw new AccessError(400,'INVALID_IMAGE','Imagen saneada demasiado grande.');const rid=randomUUID();await this.academy.access.mutate(token,'students.manage','file.upload',{studentId:sid,purpose:d.purpose},async(current,tx)=>{
   await this.academy.access.db.query("INSERT INTO academy_files(id,tenant_id,student_id,purpose,mime,bytes,created_at) VALUES (:id,:tenant,:student,:purpose,'image/jpeg',:bytes,:at)",{replacements:{id:rid,tenant:a.tenant_id,student:sid,purpose:d.purpose,bytes,at:new Date(this.academy.access.now()).toISOString()},transaction:tx});await this.academy.access.audit(a.tenant_id,current.id,'file.uploaded',{id:rid,studentId:sid,purpose:d.purpose,bytes:bytes.length},tx);
  });return {id:rid};
 }
 async read(token:string,fileId:string){const a=await this.academy.access.actor(token);checked(()=>id(fileId));const row=(await this.academy.access.rows<{student_id:string;purpose:string;bytes:Buffer;mime:string;user_id:string|null}>('SELECT f.student_id,f.purpose,f.bytes,f.mime,s.user_id FROM academy_files f JOIN academy_students s ON s.id=f.student_id AND s.tenant_id=f.tenant_id WHERE f.tenant_id=:tenant AND f.id=:id',{tenant:a.tenant_id,id:fileId}))[0];if(!row)throw new AccessError(404,'NOT_FOUND','Archivo no encontrado.');if(!a.permissions.includes('students.read')&&!(a.permissions.includes('portal.read')&&row.user_id===a.id)){if(row.purpose!=='PHOTO')throw new AccessError(404,'NOT_FOUND','Archivo no encontrado.');await this.academy.studentDetail(token,row.student_id);}return row;
 }
 async list(token:string,studentId:string){const a=await this.academy.access.actor(token);checked(()=>id(studentId));if(a.permissions.includes('students.read')||a.permissions.includes('assigned.read'))await this.academy.studentDetail(token,studentId);else if(!a.permissions.includes('portal.read')||!(await this.academy.access.rows('SELECT id FROM academy_students WHERE tenant_id=:tenant AND id=:id AND user_id=:user',{tenant:a.tenant_id,id:studentId,user:a.id})).length)throw new AccessError(404,'NOT_FOUND','Alumno no encontrado.');return this.academy.access.rows<{id:string;purpose:string;created_at:Date}>("SELECT id,purpose,created_at FROM academy_files WHERE tenant_id=:tenant AND student_id=:student AND (:proof OR purpose='PHOTO') ORDER BY created_at DESC LIMIT 100",{tenant:a.tenant_id,student:studentId,proof:a.permissions.includes('students.read')||a.permissions.includes('portal.read')});}
}
function token(r:FastifyRequest){const v=r.headers.authorization;if(!v?.startsWith('Bearer '))throw new AccessError(401,'UNAUTHENTICATED','Inicia sesión.');return v.slice(7);}
export function filesRoutes(app:FastifyInstance,service:PrivateFiles){
 app.post('/operations/files',{bodyLimit:7*1024*1024,config:{rateLimit:{max:20,timeWindow:'1 minute'}}},r=>service.upload(token(r),r.body));
 app.get<{Params:{id:string}}>('/operations/files/:id',async(r,reply)=>{const f=await service.read(token(r),r.params.id);return reply.header('X-Content-Type-Options','nosniff').type(f.mime).send(f.bytes);});
 app.get<{Params:{id:string}}>('/operations/students/:id/files',r=>service.list(token(r),r.params.id));
}
