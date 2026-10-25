/** Literal/hostname screening; provider HTTP adapters must also revalidate DNS and every redirect. */
export function isPublicWebTarget(value:string):boolean {
 try {
  const url=new URL(value),host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return false;
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.lan')||!host.includes('.')&&!host.includes(':'))return false;
  if(host.includes(':'))return !(host==='::'||host==='::1'||host.startsWith('::ffff:')||/^(fc|fd|fe[89ab]|ff)/.test(host));
  const parts=host.split('.').map(Number);
  if(parts.length===4&&parts.every(v=>Number.isInteger(v)&&v>=0&&v<=255)) {
   const [a,b]=parts as [number,number,number,number];
   return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127);
  }
  return true;
 }catch{return false;}
}
