import { runtime } from '../src/runtime.mjs';
let instance;
export default async function api(req,res){
 try{instance??=runtime();}
 catch{
  res.statusCode=503;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify({error:'Staging service is not configured'}));return;
 }
 return instance.handle(req,res);
}
