import type {FastifyInstance,FastifyRequest} from 'fastify';
import {AccessError} from '../access/policy.js';
import {OperationsService} from './service.js';
function token(r:FastifyRequest){const v=r.headers.authorization;if(!v?.startsWith('Bearer '))throw new AccessError(401,'UNAUTHENTICATED','Inicia sesión.');return v.slice(7);}
export function operationsRoutes(app:FastifyInstance,service:OperationsService){
 app.post('/operations/cash/open',r=>service.openCash(token(r),r.body));
 app.post('/operations/cash/movement',r=>service.movement(token(r),r.body));
 app.post('/operations/cash/close',r=>service.closeCash(token(r),r.body));
 app.post('/operations/cash/reopen',r=>service.reopenCash(token(r),r.body));
 app.get<{Params:{id:string}}>('/operations/cash/:id',r=>service.cashDetail(token(r),r.params.id));
 app.get<{Params:{id:string}}>('/operations/cash/:id/pdf',async(r,reply)=>reply.type('application/pdf').header('Content-Disposition','inline; filename="cierre.pdf"').send(await service.cashPdf(token(r),r.params.id)));
 app.post('/operations/payments',r=>service.createPayment(token(r),r.body));
 app.post('/operations/payments/verify',r=>service.verifyPayment(token(r),r.body));
 app.post('/operations/enrollments/adjust',r=>service.adjust(token(r),r.body));
 app.post('/operations/students/reset',r=>service.resetStudent(token(r),r.body));
 app.post('/operations/cards/rotate',r=>service.rotateCard(token(r),r.body));
 app.post('/operations/attendance',r=>service.attendance(token(r),r.body));
 app.post('/operations/notices',r=>service.notice(token(r),r.body));
 for(const kind of ['cashboxes','payments','attendance'])app.get<{Querystring:{month?:string}}>('/operations/'+kind,r=>service.list(token(r),kind,r.query.month??new Date().toISOString().slice(0,7)));
 app.get<{Querystring:{month?:string}}>('/operations/report',r=>service.report(token(r),r.query.month??new Date().toISOString().slice(0,7)));
 app.get('/portal',r=>service.portal(token(r)));
 app.get<{Params:{id:string}}>('/operations/receipts/:id',r=>service.receipt(token(r),r.params.id));
 app.get<{Params:{id:string}}>('/operations/receipts/:id/pdf',async(r,reply)=>reply.type('application/pdf').header('Content-Disposition','inline; filename="comprobante.pdf"').send(await service.receiptPdf(token(r),r.params.id)));
}
