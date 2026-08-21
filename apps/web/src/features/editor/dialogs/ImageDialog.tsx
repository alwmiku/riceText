import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Upload } from 'lucide-react';
import { Button, Dialog } from '../../../components/ui';
import { uploadAsset } from '../../../lib/api';
import type { UploadedAsset } from '../../../lib/types';

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
