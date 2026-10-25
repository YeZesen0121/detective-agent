import { ClientError } from '../api/client.js';
export interface LocalImage{key:string;file:File;caseId:string|null}
export function selectLocalImages(current:LocalImage[],files:File[]):LocalImage[]{
 const all=[...current,...files.map(file=>({key:crypto.randomUUID(),file,caseId:null}))];
 if(all.length>3||all.some(x=>x.file.size<=0||x.file.size>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(x.file.type))||all.reduce((sum,x)=>sum+x.file.size,0)>24*1024*1024)throw new ClientError('VALIDATION_ERROR','最多 3 张 PNG/JPEG/WebP 截图，每张不超过 8 MiB，合计不超过 24 MiB；原选择已保留。');
 return all;
}
