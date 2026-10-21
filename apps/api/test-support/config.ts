import { readConfig } from '../src/config.js';
export function readTestConfig(env:NodeJS.ProcessEnv=process.env){
 const configured=env.API_TEST_DATABASE_URL;
 try {
  if(!configured)throw new Error();
  const url=new URL(configured);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error();
 }catch{throw new Error('Configura API_TEST_DATABASE_URL de pruebas local, con base terminada en _test. Nunca se usa API_DATABASE_URL como sustituto.');}
 return readConfig({...env,NODE_ENV:'test',API_DATABASE_URL:configured,API_DATABASE_SSL:'disable'});
}
