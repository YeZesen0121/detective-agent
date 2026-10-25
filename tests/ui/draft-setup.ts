import { expect,type Page } from '@playwright/test';

// Existing draft/recovery tests deliberately arrange a draft through real HTTP.
// The user-facing new-case journey is covered separately by media-one-click.spec.
export async function prepareDraft(page:Page){
 const originalQuestion=await page.getByLabel('要调查的问题').inputValue(),mode=await page.locator('.mode.sel b').innerText(),present=await page.locator('main form .seg button.on').innerText();
 const input={originalQuestion,basicMode:mode==='查最新'?'latest':mode==='查模糊'?'identify':'truth',presentationMode:present==='简答'?'brief':present==='侦探伴读'?'companion':'evidence'};
 const id=await page.evaluate(async body=>{const response=await fetch('/api/v1/investigations',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify(body)});if(response.status!==201)throw Error('controlled_fixture draft setup failed');return(await response.json()).data.id as string;},input);
 const url=new URL(page.url());url.searchParams.set('case',id);url.searchParams.delete('version');await page.goto(url.toString());await expect(page.getByLabel('要调查的问题')).toHaveValue(originalQuestion);
}
