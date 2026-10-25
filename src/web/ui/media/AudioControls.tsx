import { useEffect, useState } from 'react';
import type { AudioSessionController } from '../../controllers/audio-session.js';

export function AudioControls({controller}:{controller:AudioSessionController}){
 const [state,setState]=useState(controller.getState()),[voice,setVoice]=useState('');
 useEffect(()=>{setState(controller.getState());return controller.subscribe(()=>setState(controller.getState()));},[controller]);
 const voiceIds=state.voices.map(v=>v.id).join('|');
 useEffect(()=>{setVoice(state.manifestVoiceId??state.voices[0]?.id??'');},[state.binding?.segmentId,voiceIds,state.manifestVoiceId]);
 const manifest=state.manifest,unfinished=!!manifest&&!['ready','partial','failed','cancelled'].includes(manifest.status);
 const pending=state.busy||state.loading||state.submission?.outcome==='unknown'||state.submission?.outcome==='pending';
 return <section className="media-audio" aria-label="本段音频">
  <h3>本段音频</h3><p>声音不会自动播放。生成与播放分开，文字始终可读。</p>
  {state.budget&&!state.budget.configured&&<p>语音/伴读服务尚未配置；可以继续阅读已有文字。</p>}
  {state.budget?.ttsCharacters&&<p>朗读额度剩余 {state.budget.ttsCharacters.remaining} 字符。</p>}
  <label>音色<select value={voice} disabled={pending||unfinished} onChange={event=>setVoice(event.target.value)}>{state.voices.length===0?<option value="">暂无可用音色</option>:state.voices.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
  {state.manifestVoiceId&&<p>当前任务音色：{state.voices.find(v=>v.id===state.manifestVoiceId)?.label??state.manifestVoiceId}</p>}
  <div className="media-actions">
   {!manifest&&<button type="button" disabled={pending||!voice} onClick={()=>{void controller.generate(voice);}}>生成本段音频</button>}
   {manifest&&voice!==state.manifestVoiceId&&<button type="button" disabled={pending||unfinished||!voice} onClick={()=>{void controller.generate(voice);}}>用所选音色生成新音频</button>}
   {manifest&&['partial','failed','cancelled'].includes(manifest.status)&&<button type="button" disabled={pending||!state.manifestVoiceId||!state.voices.some(v=>v.id===state.manifestVoiceId&&v.available)} onClick={()=>{if(state.manifestVoiceId)void controller.generate(state.manifestVoiceId,true);}}>明确重试生成</button>}
   <button type="button" disabled={!manifest?.chunks.some(c=>c.status==='ready')||unfinished||state.playback.status==='playing'} onClick={()=>{void controller.play();}}>播放已保存音频</button>
   <button type="button" onClick={()=>controller.stop()}>停止播放</button>
   {unfinished&&<button type="button" disabled={state.busy} onClick={()=>{void controller.cancel();}}>取消生成</button>}
   <button type="button" disabled={state.loading||state.busy} onClick={()=>{void controller.refresh();}}>只读核对音频</button>
  </div>
  {state.submission?.outcome==='unknown'&&<p role="status">音频提交未确认，正在按原标识只读核对。请勿重复生成。</p>}
  {manifest&&<p role="status">{manifest.status==='ready'?'音频已保存':manifest.status==='partial'?'音频只保存了一部分':manifest.status==='cancelled'?'生成已取消，已保存片段仍可播放':manifest.status==='failed'?'生成失败，文字仍可阅读':'正在生成音频'} · {manifest.chunks.filter(c=>c.status==='ready').length} 个片段</p>}
  {state.playback.status==='playing'&&<p role="status">正在播放第 {(state.playback.chunkIndex??0)+1} 个片段</p>}
  {(state.error??state.playback.error)&&<p role="alert">{(state.error??state.playback.error)?.message}</p>}
 </section>;
}
