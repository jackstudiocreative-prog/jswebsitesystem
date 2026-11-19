// Small RFC 4180 CSV reader (quoted fields, "" escapes, commas and line breaks inside quotes, CRLF, BOM).
// → array of rows (arrays of strings). Used for Shopify's customer export.
export function parseCsv(text){
 const s=String(text).replace(/^﻿/,'');const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(quoted){if(c==='"'){if(s[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;continue;}
  if(c==='"'&&field==='')quoted=true;
  else if(c===',')row.push(field),field='';
  else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v!==''))rows.push(row);row=[];}
  else field+=c;
 }
 row.push(field);if(row.some(v=>v!==''))rows.push(row);
 return rows;
}
// Header row + data rows → objects keyed by header, keeping only the wanted headers (case-insensitive).
export function csvObjects(text,wanted){
 const [head=[],...data]=parseCsv(text);const keep=new Set(wanted.map(w=>w.toLowerCase()));
 const cols=head.map((h,i)=>[h.trim(),i]).filter(([h])=>!wanted.length||keep.has(h.toLowerCase()));
 return {headers:head.map(h=>h.trim()),rows:data.map(r=>Object.fromEntries(cols.map(([h,i])=>[h,r[i]??''])))};
}
