import { IdSchema } from '../../../shared/contracts.js';
import { ClientError, parseInput } from '../../api/client.js';
import type { AudioDriver } from '../../controllers/audio.js';

/** Direct same-origin media URL preserves the user's play gesture and HTTP Range support. */
export function createBrowserAudioDriver({createAudio=()=>new Audio()}:{createAudio?:()=>HTMLAudioElement}={}):AudioDriver{
 let active:{finish:(error?:unknown)=>void}|null=null;
 const stopped=()=>new ClientError('ABORTED','播放已停止。');
 const stop=()=>{const previous=active;active=null;previous?.finish(stopped());};
 return {stop,play(assetId,signal){
  const id=parseInput(IdSchema,assetId);stop();if(signal.aborted)return Promise.reject(stopped());
  return new Promise<void>((resolve,reject)=>{
   const element=createAudio();let done=false;
   const finish=(error?:unknown)=>{if(done)return;done=true;if(active?.finish===finish)active=null;signal.removeEventListener('abort',abort);element.removeEventListener('ended',ended);element.removeEventListener('error',failed);element.pause();element.removeAttribute('src');element.load();error?reject(error):resolve();};
   const abort=()=>finish(stopped()),ended=()=>finish(),failed=()=>finish(new ClientError('AUDIO_FAILED','音频读取或解码失败，文字仍可阅读。请重新读取音频状态。'));
   active={finish};signal.addEventListener('abort',abort,{once:true});element.addEventListener('ended',ended);element.addEventListener('error',failed);element.preload='none';element.src=`/api/v1/audio-assets/${id}`;
   try{void element.play().catch(error=>{if(done)return;finish(new ClientError('AUDIO_FAILED',error instanceof DOMException&&error.name==='NotAllowedError'?'浏览器未允许播放，请再次点击播放；不会重新生成音频。':'音频播放失败，文字仍可阅读。'));});}catch{failed();}
  });
 }};
}
