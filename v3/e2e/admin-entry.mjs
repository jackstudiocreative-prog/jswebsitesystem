// E2E only: mounts the real staff workspace with a fixed test identity instead of Supabase sign-in
// (sign-in, invitation and MFA flows have their own DOM tests). Never part of the production build.
import {mountAdmin} from '../admin/catalog-ui.mjs';
const role=new URLSearchParams(location.search).get('role')??'editor';
const api=async(path,body,method=body?'POST':'GET')=>{const r=await fetch('/api/v3/'+path,{method,headers:{Authorization:'Bearer '+role,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
document.getElementById('auth').hidden=true;
document.getElementById('workspace').hidden=false;
const toast=t=>{const n=document.getElementById('toast');n.textContent=t;n.hidden=!t;};
mountAdmin(api,role,toast,{email:role+'@e2e.test',signOut:async()=>{toast('Signed out (test)');},changePassword:async()=>{toast('A password reset email has been sent to '+role+'@e2e.test.');}}).reload();
