import { useEffect, useState } from 'react';
import type { AttachmentController } from '../../controllers/attachments.js';
import type { ExperienceApi } from '../../api/experience.js';

export function AttachmentsPanel({controller,api,locked=false}:{controller:AttachmentController;api:ExperienceApi;locked?:boolean}){
 const [state,setState]=useState(controller.getState());
 useEffect(()=>{setState(controller.getState());return controller.subscribe(()=>setState(controller.getState()));},[controller]);
 const unresolved=state.submissions.filter(r=>r.outcome==='pending'||r.outcome==='unknown');
 return <section className="media-panel" aria-label="案件截图">
  <h3>案件截图</h3><p>最多 3 张，每张 8 MiB。截图是待核验线索，上传成功不代表内容已查证。</p>
  <label>上传截图<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={locked||state.loading||state.items.length+unresolved.length>=3} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void(async()=>{for(const file of files)await controller.upload(file);})();}}/></label>
  <ol className="media-attachments">{state.items.map((item,index)=><li key={item.id}><a href={api.attachmentUrl(item.id)} target="_blank" rel="noreferrer"><img src={api.attachmentUrl(item.id)} alt={`截图 ${index+1}`} loading="lazy"/></a><span>截图 {index+1} · 已保存 · {item.status}</span><button type="button" disabled={locked||state.loading} onClick={()=>{void controller.remove(item.id);}}>删除截图 {index+1}</button></li>)}</ol>
  {state.submissions.filter(r=>r.outcome!=='confirmed').map((row,index)=><p role="status" key={row.key}>上传 {index+1}：{row.outcome==='pending'?'正在上传':row.outcome==='unknown'?'提交未确认，请只读核对；暂不能开查':'上传失败，请核对后重新选择图片'}</p>)}
  {state.error&&<p role="alert">{state.error.message}</p>}
  <button type="button" disabled={state.loading} onClick={()=>{void controller.refresh();}}>{state.loading?'正在核对截图…':'重新核对截图'}</button>
 </section>;
}
