import type {FastifyInstance,FastifyRequest} from 'fastify';
import {AccessError} from '../access/policy.js';
import {AcademyService} from './service.js';
function token(request:FastifyRequest){const value=request.headers.authorization;if(!value?.startsWith('Bearer '))throw new AccessError(401,'UNAUTHENTICATED','Inicia sesión.');return value.slice(7);}
export function academyRoutes(app:FastifyInstance,service:AcademyService){
 app.get('/academy/settings',r=>service.settings(token(r)));
 app.post('/academy/settings',r=>service.saveSettings(token(r),r.body));
 for(const kind of ['plans','trainers','classes','students','enrollments'])app.get<{Querystring:{offset?:string;limit?:string;month?:string;search?:string}}>('/academy/'+kind,{schema:{querystring:{type:'object',additionalProperties:false,properties:{offset:{type:'string',pattern:'^[0-9]{1,6}$'},limit:{type:'string',pattern:'^[0-9]{1,3}$'},month:{type:'string',pattern:'^20[0-9]{2}-(0[1-9]|1[0-2])$'},search:{type:'string',maxLength:100}}}}},r=>service.list(token(r),kind,{...r.query,offset:r.query.offset===undefined?undefined:Number(r.query.offset),limit:r.query.limit===undefined?undefined:Number(r.query.limit)}));
 app.post('/academy/plans',r=>service.savePlan(token(r),r.body));
 app.post('/academy/trainers',r=>service.saveTrainer(token(r),r.body));
 app.post('/academy/classes',r=>service.saveClass(token(r),r.body));
 app.post('/academy/students',r=>service.saveStudent(token(r),r.body));
 app.get<{Params:{id:string}}>('/academy/students/:id',r=>service.studentDetail(token(r),r.params.id));
 app.get('/academy/assigned',r=>service.assigned(token(r)));
 app.post('/academy/enrollments',r=>service.enroll(token(r),r.body));
 app.post('/academy/enrollments/decision',r=>service.decision(token(r),r.body));
 app.post('/academy/enrollments/schedule',r=>service.schedule(token(r),r.body));
 app.get<{Params:{academy:string}}>('/public/:academy/catalog',r=>service.publicCatalog(r.params.academy));
 app.post<{Params:{academy:string}}>('/public/:academy/applications',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},r=>service.publicApply(r.params.academy,r.body));
}
