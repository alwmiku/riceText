import { useEffect, useRef, useState } from 'react';
import { AtSign, LoaderCircle, Upload } from 'lucide-react';
import { Button, Dialog } from '../../components/ui';
import { createDice, uploadAsset } from '../../lib/api';
import { identities } from '../../lib/seed';
import type { DiceResult, UploadedAsset } from '../../lib/types';

/** 创建服务端权威骰子结果，并把已持久化 attrs 交回编辑器插入。 */
export function DiceDialog({ open, onOpenChange, onInsert }: { open: boolean; onOpenChange: (value: boolean) => void; onInsert: (result: DiceResult) => void }) {
  const [expression, setExpression] = useState('3d5');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setPending(true); setError('');
    try { onInsert(await createDice(expression)); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '骰子创建失败'); }
    finally { setPending(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange} title="插入骰子" description="结果创建后会随正文持久化，只有明确重投才会变化。" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={submit} disabled={pending}>{pending && <LoaderCircle size={15} className="animate-spin" />}投掷并插入</Button></>}>
    <label className="grid gap-2 text-sm font-semibold">骰子表达式<input className="field" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="例如 3d5、1d20+2" autoFocus /></label>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </Dialog>;
}

/** 同时支持 HTTP(S) 外链和 multipart 上传的图片属性编辑器。 */
export function ImageDialog({ open, onOpenChange, onInsert, initial }: { open: boolean; onOpenChange: (value: boolean) => void; onInsert: (asset: UploadedAsset | null, values: { src: string; alt: string; caption: string; align: string; width: number }) => void; initial?: { src: string; alt: string; caption: string; align: string; width: number } }) {
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [align, setAlign] = useState('center');
  const [width, setWidth] = useState(80);
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setSrc(initial?.src ?? '');
    setAlt(initial?.alt ?? '');
    setCaption(initial?.caption ?? '');
    setAlign(initial?.align ?? 'center');
    setWidth(initial?.width ?? 80);
    setAsset(null);
  }, [open, initial]);
  // 外链只允许 HTTP(S) 或本站资产路径；本地文件必须先完成上传并取得稳定 assetId。
  const valid = asset !== null || /^(https?:\/\/|\/api\/assets\/|\/uploads\/|blob:)/i.test(src);
  const pickFile = async (file?: File) => {
    if (!file) return;
    setPending(true);
    try { const next = await uploadAsset(file); setAsset(next); setSrc(next.url); if (!alt) setAlt(file.name.replace(/\.[^.]+$/, '')); }
    finally { setPending(false); }
  };
  const editing = Boolean(initial);
  return <Dialog open={open} onOpenChange={onOpenChange} title={editing ? '编辑图片' : '插入图片'} description="可使用 HTTP(S) 外链，或上传到本站媒体服务。" className="max-w-xl" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!valid || pending} onClick={() => { onInsert(asset, { src, alt, caption, align, width }); onOpenChange(false); }}>{editing ? '保存修改' : '插入图片'}</Button></>}>
    <div className="grid gap-4">
      <div className="grid grid-cols-[1fr_auto] gap-2"><input className="field" value={src} onChange={(event) => { setSrc(event.target.value); setAsset(null); }} placeholder="https://example.com/image.jpg" aria-label="图片地址" /><Button variant="outline" onClick={() => inputRef.current?.click()} disabled={pending}>{pending ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />}上传</Button></div>
      <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void pickFile(event.target.files?.[0])} />
      {src && <div className="grid h-36 place-items-center overflow-hidden rounded-md bg-muted"><img src={src} alt="图片预览" className="max-h-full max-w-full object-contain" /></div>}
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs font-semibold">替代文字<input className="field" value={alt} onChange={(event) => setAlt(event.target.value)} /></label><label className="grid gap-1.5 text-xs font-semibold">图片说明<input className="field" value={caption} onChange={(event) => setCaption(event.target.value)} /></label></div>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs font-semibold">对齐<select className="field" value={align} onChange={(event) => setAlign(event.target.value)}><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></label><label className="grid gap-1.5 text-xs font-semibold">宽度：{width}%<input type="range" min="20" max="100" step="5" value={width} onChange={(event) => setWidth(Number(event.target.value))} className="h-10 accent-[#197c73]" /></label></div>
    </div>
  </Dialog>;
}

/** 收集可检索小说摘录的来源元数据、展示 preset 和正文。 */
export function ExcerptDialog({ open, onOpenChange, onInsert }: { open: boolean; onOpenChange: (value: boolean) => void; onInsert: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState({ bookTitle: '雾港来信', chapterTitle: '第三章', author: '林稻', sourceUrl: '', variant: 'desktop-book', text: '' });
  const field = (key: keyof typeof values) => ({ value: values[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((current) => ({ ...current, [key]: event.target.value })) });
  return <Dialog open={open} onOpenChange={onOpenChange} title="插入小说摘录" description="使用可检索文字替代截图证据，并保留作品和章节来源。" className="max-w-xl" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!values.text.trim()} onClick={() => { onInsert(values); onOpenChange(false); }}>插入摘录</Button></>}>
    <div className="grid gap-3"><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs font-semibold">书名<input className="field" {...field('bookTitle')} /></label><label className="grid gap-1.5 text-xs font-semibold">章节<input className="field" {...field('chapterTitle')} /></label></div><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs font-semibold">作者<input className="field" {...field('author')} /></label><label className="grid gap-1.5 text-xs font-semibold">排版<select className="field" {...field('variant')}><option value="desktop-book">通用书站 · 桌面</option><option value="mobile-book">通用书站 · 手机</option><option value="forum-evidence">论坛证据</option></select></label></div><label className="grid gap-1.5 text-xs font-semibold">来源链接（可选）<input className="field" {...field('sourceUrl')} placeholder="https://example.com/chapter" /></label><label className="grid gap-1.5 text-xs font-semibold">摘录正文<textarea className="field-area min-h-36" {...field('text')} /></label></div>
  </Dialog>;
}

/** 好友即时搜索与非好友待解析 mention 的演示选择器。 */
export function MentionDialog({ open, onOpenChange, onInsert }: { open: boolean; onOpenChange: (value: boolean) => void; onInsert: (user: { id: string; name: string; resolved: boolean; avatarUrl: string | null }) => void }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  // 260ms 延迟模拟真实好友/用户搜索的 debounce 与 loading 状态。
  useEffect(() => { if (!query) return; setSearching(true); const timer = window.setTimeout(() => setSearching(false), 260); return () => window.clearTimeout(timer); }, [query]);
  const friends = identities.filter((identity) => identity.name.includes(query) || identity.id.includes(query));
  return <Dialog open={open} onOpenChange={onOpenChange} title="提及用户" description="好友即时匹配；非好友会在发往服务器后解析。" className="max-w-md">
    <div className="relative"><AtSign className="absolute left-3 top-3 text-muted-foreground" size={16} /><input className="field pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按名字或 ID 搜索" autoFocus /></div>
    <div className="mt-3 min-h-32 space-y-1">{searching ? <div className="grid h-24 place-items-center"><LoaderCircle size={18} className="animate-spin text-primary" /></div> : friends.map((user) => <button type="button" key={user.id} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => { onInsert({ id: user.id, name: user.name, resolved: true, avatarUrl: null }); onOpenChange(false); }}><span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">{user.avatar}</span><span><strong className="block text-sm">{user.name}</strong><small className="text-muted-foreground">{user.id} · 好友</small></span></button>)}{query && !searching && friends.length === 0 && <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-muted" onClick={() => { onInsert({ id: query, name: query, resolved: false, avatarUrl: null }); onOpenChange(false); }}><span className="grid h-8 w-8 place-items-center rounded-full bg-muted"><AtSign size={15} /></span><span><strong className="block text-sm">@{query}</strong><small className="text-muted-foreground">非好友 · 发布后由服务器确认</small></span></button>}</div>
  </Dialog>;
}
