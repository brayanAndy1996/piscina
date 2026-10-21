/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads its Metro configuration as CommonJS. */
const {getDefaultConfig}=require('expo/metro-config');
const config=getDefaultConfig(__dirname);
// The shared pure rules also compile as Node ESM, where relative .js imports are required.
config.resolver.resolveRequest=(context,moduleName,platform)=>context.resolveRequest(context,(/\/(apps\/api\/src|contracts)\//.test(context.originModulePath.replaceAll('\\','/')))&&moduleName.startsWith('.')&&moduleName.endsWith('.js')?moduleName.slice(0,-3):moduleName,platform);
module.exports=config;
