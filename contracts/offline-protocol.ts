export type RecordRow=Record<string,unknown>;
export interface OfflineGrant {payload:string;signature:string;}
export interface OfflineOperation {sequence:number;action:string;input:RecordRow;capturedAt:number;grant:OfflineGrant;basis:RecordRow;signature:string;}
export interface BusinessState {tenantId:string;userId:string;deviceId:string;tables:Record<string,RecordRow[]>;}
export interface SyncReceipt {sequence:number;operationId:string;status:'ACCEPTED'|'REJECTED';result:RecordRow;}
export const offlineActions=['student.save','enrollment.create','enrollment.decision','enrollment.schedule','cash.open','cash.movement','cash.close','payment.create','payment.verify','attendance.create','file.upload'] as const;
