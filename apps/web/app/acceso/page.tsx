'use client';
import { useEffect,useState,type FormEvent } from 'react';
interface User {id:string;tenant_id:string;tenant_slug:string;username:string;display_name:string;role:string;permissions:string[];version:number;active:boolean;must_change:boolean;}
interface Device {id:string;name:string;designated:boolean;offline_expires_at:string|null;}
interface Role {name:string;permissions:string[];}
interface Audit {id:string;event:string;created_at:string;details:Record<string,unknown>;}
async function api<T>(path:string,method='GET',body?:object):Promise<T>{
 const response=await fetch('/api/access/'+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error??'No se pudo completar la acción.');return data;
}
export default function AccessPage(){
 const [user,setUser]=useState<User|null>(null),[users,setUsers]=useState<User[]>([]),[devices,setDevices]=useState<Device[]>([]),[roles,setRoles]=useState<Role[]>([]),[audit,setAudit]=useState<Audit[]>([]);
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){
  const me=await api<User>('auth/me');setUsers([]);setDevices([]);setRoles([]);setAudit([]);setUser(me);
  if(!me.must_change){
   if(me.permissions.includes('users.read'))setUsers(await api<User[]>('users'));
   if(me.permissions.includes('roles.read'))setRoles(await api<Role[]>('roles'));
   if(me.permissions.includes('devices.read'))setDevices(await api<Device[]>('devices'));
   if(me.permissions.includes('audit.read'))setAudit(await api<Audit[]>('audit'));
  }
 }
 useEffect(()=>{void refresh().catch(()=>{});},[]);
 async function act(task:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await task();}catch(error){setMessage(error instanceof Error?error.message:'Error de conexión.');}finally{setBusy(false);}}
 function login(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,values=new FormData(form);void act(async()=>{await api('auth/login','POST',Object.fromEntries(values));form.reset();await refresh();});}
 function changePassword(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,values=new FormData(form);void act(async()=>{await api('auth/password','POST',Object.fromEntries(values));form.reset();setUser(null);setMessage('Contraseña actualizada. Inicia sesión nuevamente.');});}
 function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,values=new FormData(form);void act(async()=>{await api('users','POST',Object.fromEntries(values));form.reset();await refresh();setMessage('Usuario creado. Debe cambiar su contraseña temporal.');});}
 function edit(event:FormEvent<HTMLFormElement>,target:User){event.preventDefault();const values=new FormData(event.currentTarget);void act(async()=>{await api('users/'+target.id,'PATCH',{displayName:values.get('displayName'),role:values.get('role'),active:values.get('active')==='on',version:target.version});if(target.id===user?.id){setUser(null);setMessage('Tu sesión fue revocada tras el cambio.');}else{await refresh();setMessage('Usuario actualizado; sesiones anteriores revocadas.');}});}
 function reset(event:FormEvent<HTMLFormElement>,target:User){event.preventDefault();const form=event.currentTarget,values=new FormData(form);void act(async()=>{await api('users/'+target.id+'/reset-password','POST',{password:values.get('password')});form.reset();await refresh();setMessage('Contraseña temporal restablecida.');});}
 return <main><h1>Acceso y administración</h1><p><a href="/">Estado del servicio</a></p>{message&&<p role="status">{message}</p>}
 {!user?<form onSubmit={login}><h2>Iniciar sesión</h2><label>Academia <input name="academy" required autoComplete="organization"/></label><label>Usuario <input name="username" required autoComplete="username"/></label><label>Contraseña <input name="password" required type="password" autoComplete="current-password"/></label><button disabled={busy}>Entrar</button></form>:<>
 <section><h2>{user.display_name}</h2><p>Academia: {user.tenant_slug} · Rol: {user.role}</p><p>Permisos: {user.permissions.join(', ')||'Solo acceso a tu perfil'}</p><button disabled={busy} onClick={()=>{void act(async()=>{try{await api('auth/logout','POST');}finally{setUser(null);setUsers([]);setDevices([]);setRoles([]);setAudit([]);}});}}>Cerrar sesión</button></section>
 <form onSubmit={changePassword}><h2>{user.must_change?'Cambia tu contraseña temporal':'Cambiar contraseña'}</h2><label>Contraseña actual <input name="currentPassword" type="password" required autoComplete="current-password"/></label><label>Nueva contraseña (12–128 caracteres) <input name="newPassword" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label><button disabled={busy}>Actualizar contraseña</button></form>
 {!user.must_change&&<>
 {user.permissions.includes('users.manage')&&<section><h2>Usuarios</h2><form onSubmit={create}><label>Usuario <input name="username" required minLength={3} maxLength={64}/></label><label>Nombre <input name="displayName" required maxLength={100}/></label><label>Rol <select name="role">{roles.map(r=><option key={r.name}>{r.name}</option>)}</select></label><label>Contraseña temporal <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><button disabled={busy}>Crear usuario</button></form>
 {users.map(u=><article key={u.id}><h3>{u.username}</h3><form onSubmit={e=>edit(e,u)}><label>Nombre <input name="displayName" defaultValue={u.display_name} required/></label><label>Rol <select name="role" defaultValue={u.role}>{roles.map(r=><option key={r.name}>{r.name}</option>)}</select></label><label><input type="checkbox" name="active" defaultChecked={u.active}/> Activo</label><button disabled={busy}>Guardar y revocar sesiones</button></form>{u.id!==user.id&&<form onSubmit={e=>reset(e,u)}><label>Nueva contraseña temporal <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><button disabled={busy}>Restablecer contraseña</button></form>}</article>)}</section>}
 {roles.length>0&&<section><h2>Roles y permisos iniciales</h2>{roles.map(r=><p key={r.name}><strong>{r.name}</strong>: {r.permissions.join(', ')||'Perfil propio'}</p>)}</section>}
 {user.permissions.includes('devices.read')&&<section><h2>Celular autorizado para acceso offline</h2><p>Registra primero la clave desde la aplicación Android. Un permiso vigente impide reemplazar el equipo hasta su vencimiento.</p>{devices.length===0&&<p>No hay celulares registrados.</p>}{devices.map(d=><article key={d.id}><h3>{d.name}</h3><p>{d.designated?'Designado':'No designado'} · {d.id}</p>{d.designated&&d.offline_expires_at&&<p>Último permiso vence: {new Date(d.offline_expires_at).toLocaleString('es-PE')}</p>}{user.permissions.includes('devices.manage')&&!d.designated&&<button disabled={busy} onClick={()=>{void act(async()=>{await api('devices/'+d.id+'/designate','POST',{expectedDeviceId:devices.find(device=>device.designated)?.id??null});await refresh();setMessage('Celular designado. Sincroniza acceso desde ese equipo.');});}}>Designar este celular</button>}</article>)}</section>}
 {user.permissions.includes('audit.read')&&<section><h2>Auditoría reciente</h2><button disabled={busy} onClick={()=>{void act(refresh);}}>Actualizar</button>{audit.map(a=><p key={a.id}>{new Date(a.created_at).toLocaleString('es-PE')} · {a.event} · {JSON.stringify(a.details)}</p>)}</section>}
 </>}
 </>}
 </main>;
}
