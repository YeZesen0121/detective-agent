import json, pathlib, re, hashlib, struct, html
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).parent
data = json.loads((ROOT / 'article-extracted.json').read_text(encoding='utf-8'))
URL = 'https://mp.weixin.qq.com/s/4i4hQB0oX3ED6PVwGwSC2w?scene=1'

class Markdown(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.images=0
    def handle_starttag(self, tag, attrs):
        if tag in ('p','section','div','br','li','h1','h2','h3'): self.parts.append('\n\n')
        if tag=='img':
            self.images+=1; self.parts.append(f'\n\n![原文图片 {self.images:02d}](images/{self.images:02d}.png)\n\n')
    def handle_endtag(self,tag):
        if tag in ('p','section','div','li','h1','h2','h3'): self.parts.append('\n\n')
    def handle_data(self,text): self.parts.append(text)

parser=Markdown(); parser.feed(data['html'])
body=re.sub(r'\n[ \t\u00a0]*\n(?:[ \t\u00a0]*\n)+','\n\n',''.join(parser.parts)).strip()
header=f'# {data["title"]}\n\n来源：{URL}\n\n作者：WaytoAGI；公众号：通往AGI之路。发布时间：2026-10-20 16:22，页面标注浙江。\n\n归档日期：2026-10-24（Asia/Shanghai）。正文和图片按原文顺序保存；换行经过整理，不改写措辞。图片文字另见《图片文字与核验记录》。\n\n---\n\n'
(ROOT/'原文全文.md').write_text(header+body+'\n\n---\n\n## 原文链接清单\n\n'+'\n'.join(f'- {a["text"] or "内嵌链接"}：{a["href"]}' for a in data['links'] if a['href']),encoding='utf-8')
(ROOT/'原文可见文本.txt').write_text(data['text'],encoding='utf-8')
manifest=[]
for i,v in enumerate(data['images'],1):
    f=ROOT/'images'/f'{i:02d}.png'; b=f.read_bytes(); assert b[:8]==b'\x89PNG\r\n\x1a\n'
    w,h=struct.unpack('>II',b[16:24]); assert w>1 and h>1
    manifest.append(dict(index=i,file=f'images/{i:02d}.png',source=v['src'],bytes=len(b),width=w,height=h,sha256=hashlib.sha256(b).hexdigest()))
(ROOT/'images-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
# Readable offline page: extracted text and local images only, no original scripts.
pieces=[]
for part in re.split(r'(!\[原文图片 \d+\]\(images/\d+\.png\))',body):
    m=re.fullmatch(r'!\[(.*?)\]\((.*?)\)',part)
    if m: pieces.append(f'<figure><img src="{m[2]}" alt="{m[1]}"><figcaption>{m[1]}</figcaption></figure>')
    else: pieces.extend('<p>'+html.escape(p).replace('\n','<br>')+'</p>' for p in part.split('\n\n') if p.strip())
(ROOT/'原文离线阅读.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+html.escape(data['title'])+'</title><style>body{max-width:760px;margin:40px auto;padding:0 24px;font:18px/1.85 sans-serif;color:#222}img{max-width:100%;height:auto}figure{margin:24px 0}figcaption{color:#777;font-size:14px}</style><h1>'+html.escape(data['title'])+'</h1><p>WaytoAGI / 通往AGI之路 · 2026-10-20 16:22</p><p><a href="'+URL+'">微信原文</a></p>'+''.join(pieces)+'</html>',encoding='utf-8')
norm=lambda s:re.sub(r'\s+','',s)
plain=re.sub(r'!\[原文图片 \d+\]\(images/\d+\.png\)','',body)
result={'image_count':len(manifest),'markdown_image_count':parser.images,'visible_text_matches_normalized_html':norm(plain)==norm(data['text']),'visible_text_chars':len(data['text']),'screenshots':len(list((ROOT/'screenshots').glob('top-*.png')))}
(ROOT/'archive-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False)); print([(m['file'],m['width'],m['height']) for m in manifest])
