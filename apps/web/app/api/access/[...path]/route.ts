import { NextRequest, NextResponse } from 'next/server';
export const dynamic='force-dynamic';
const allowed=/^(auth\/(login|logout|me|password)|users(\/[0-9a-f-]+(\/reset-password)?)?|roles|devices(\/[0-9a-f-]+\/designate)?|audit)$/;
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}) {
 const path=(await context.params).path.join('/');
 if(!/^(portal|operations\/(cash(\/(open|close|movement|reopen|[0-9a-f-]+(\/pdf)?))?|files(\/[0-9a-f-]+)?|students\/[0-9a-f-]+\/files|cashboxes|payments(\/verify)?|enrollments\/adjust|students\/reset|cards\/rotate|attendance|notices|report|receipts\/[0-9a-f-]+(\/pdf)?))$/.test(path)&&!allowed.test(path)&&!/^academy\/(settings|plans|trainers|classes|students(\/[0-9a-f-]+)?|assigned|enrollments(\/(decision|schedule))?)$/.test(path)&&!/^public\/[a-z0-9][a-z0-9._-]{2,63}\/(catalog|applications)$/.test(path)) return NextResponse.json({error:'Ruta no disponible.'},{status:404});
 const configured=process.env.WEB_ORIGIN;
 let expectedOrigin:string;
 try {
  if(!configured&&process.env.NODE_ENV==='production')throw new Error();
  expectedOrigin=configured??new URL(request.nextUrl.protocol+'//'+request.headers.get('host')).origin;
  const parsed=new URL(expectedOrigin);
  if(parsed.origin!==expectedOrigin||!['http:','https:'].includes(parsed.protocol))throw new Error();
  if(process.env.NODE_ENV==='production'&&parsed.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))throw new Error();
 }catch{return NextResponse.json({error:'Configura WEB_ORIGIN con el origen público de la aplicación.'},{status:503});}
 if(request.method!=='GET'&&request.headers.get('origin')!==expectedOrigin) return NextResponse.json({error:'Origen de solicitud inválido.'},{status:403});
 const token=request.cookies.get('piscina_session')?.value;
 try {
  const payload=request.method==='GET'?undefined:await request.text();
  if(payload&&payload.length>(path==='operations/files'?7*1024*1024:16000)) return NextResponse.json({error:'Solicitud demasiado grande.'},{status:413});
  const upstream=await fetch(new URL('/'+path+request.nextUrl.search,process.env.API_URL??'http://127.0.0.1:4000'),{
   method:request.method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(payload?{'Content-Type':'application/json'}:{})},
   body:payload||undefined,cache:'no-store',signal:AbortSignal.timeout(15000),
  });
  if(upstream.ok&&['application/pdf','image/jpeg'].some(type=>upstream.headers.get('content-type')?.startsWith(type)))return new NextResponse(new Uint8Array(await upstream.arrayBuffer()),{status:200,headers:{'Content-Type':upstream.headers.get('content-type')??'application/octet-stream','Content-Disposition':upstream.headers.get('content-disposition')??'inline','Cache-Control':'no-store'}});
  const data:unknown=await upstream.json();
  const record=data&&typeof data==='object'?data as Record<string,unknown>:{};
  const session=path==='auth/login'&&upstream.ok&&typeof record.token==='string'?record.token:null;
  const response=NextResponse.json(session?{user:record.user}:data,{status:upstream.status,headers:{'Cache-Control':'no-store'}});
  if(session) response.cookies.set('piscina_session',session,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:43200});
  if((path==='auth/logout'||path==='auth/password')&&upstream.ok||upstream.status===401) response.cookies.set('piscina_session','',{httpOnly:true,path:'/',maxAge:0,sameSite:'strict',secure:process.env.NODE_ENV==='production'});
  return response;
 }catch{
  const response=NextResponse.json({error:'No se pudo conectar con el servidor.'},{status:503});
  if(path==='auth/logout') response.cookies.set('piscina_session','',{httpOnly:true,path:'/',maxAge:0});
  return response;
 }
}
export {proxy as GET,proxy as POST,proxy as PATCH};
