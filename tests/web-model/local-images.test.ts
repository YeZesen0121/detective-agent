import { expect,it } from 'vitest';
import { selectLocalImages } from '../../src/web/model/local-images.js';
it('keeps browser files in memory and retains the previous selection when a fourth image is rejected',()=>{
 const files=[0,1,2,3].map(i=>new File(['controlled_fixture'],`${i}.png`,{type:'image/png'})),first=selectLocalImages([],files.slice(0,1));expect(first[0]!.file).toBe(files[0]);expect(first[0]!.caseId).toBeNull();expect(()=>selectLocalImages(first,files.slice(1))).toThrow('最多 3 张');expect(first).toHaveLength(1);expect(first[0]!.file).toBe(files[0]);
});
it('rejects empty and non-image files before any upload while allowing three distinct keys',()=>{
 expect(()=>selectLocalImages([],[new File([],'empty.png',{type:'image/png'})])).toThrow();expect(()=>selectLocalImages([],[new File(['controlled_fixture'],'x.pdf',{type:'application/pdf'})])).toThrow();const images=selectLocalImages([],[0,1,2].map(i=>new File(['controlled_fixture'],`${i}.webp`,{type:'image/webp'})));expect(new Set(images.map(x=>x.key)).size).toBe(3);
});
