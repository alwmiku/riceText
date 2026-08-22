import { ChevronDown, CornerDownRight, MessageCircle, Minus, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '../../components/ui';
import { voteComment } from '../../lib/api';
import { seedComments } from '../../lib/seed';
import type { CommentReply, SeedIdentity } from '../../lib/types';
import { createId, formatTime } from '../../lib/utils';

type SortMode = 'score' | 'recent';

/** 不改变原树引用地递归更新目标回复，用于乐观赞踩和插入楼中楼。 */
function updateTree(items: CommentReply[], id: string, update: (comment: CommentReply) => CommentReply): CommentReply[] {
  return items.map((item) => item.id === id ? update(item) : { ...item, children: updateTree(item.children, id, update) });
}

/** 单条回复及其递归子树；折叠只影响显示，不丢弃后代数据。 */
function CommentNode({ comment, onVote, onReply, depth = 0 }: {
  comment: CommentReply;
  onVote: (comment: CommentReply, vote: -1 | 0 | 1) => void;
  onReply: (comment: CommentReply) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return <article className="comment-node" aria-label={`${comment.author.name} 的回复`}>
    <span className="comment-avatar" aria-hidden="true">{comment.author.avatar}</span>
    <div className="comment-meta"><span className="comment-author">{comment.author.name}</span><span>·</span><time dateTime={comment.createdAt}>{formatTime(comment.createdAt)}</time>{comment.author.role === 'author' && <span className="rounded bg-accent px-1 text-[9px] font-bold text-accent-foreground">作者</span>}</div>
    {!collapsed && <><p className="comment-body">{comment.body}</p><div className="comment-actions">
      <IconButton className="h-7 w-7" label={comment.myVote === 1 ? '取消赞' : '赞'} active={comment.myVote === 1} onClick={() => onVote(comment, comment.myVote === 1 ? 0 : 1)}><ThumbsUp size={13} /></IconButton><span className="min-w-4 text-center text-[10px] text-muted-foreground">{comment.upvotes}</span>
      <IconButton className="h-7 w-7" label={comment.myVote === -1 ? '取消踩' : '踩'} active={comment.myVote === -1} onClick={() => onVote(comment, comment.myVote === -1 ? 0 : -1)}><ThumbsDown size={13} /></IconButton><span className="min-w-4 text-center text-[10px] text-muted-foreground">{comment.downvotes}</span>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onReply(comment)}><CornerDownRight size={13} />回复</Button>
      {comment.children.length > 0 && <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setCollapsed(true)}><Minus size={13} />折叠</Button>}
    </div></>}
    {collapsed && <Button variant="ghost" size="sm" className="mt-1 h-7 px-2" onClick={() => setCollapsed(false)}><ChevronDown size={13} />展开 {comment.children.length} 条回复</Button>}
    {!collapsed && comment.children.length > 0 && <div className="comment-children comment-tree">{comment.children.map((child) => <CommentNode key={child.id} comment={child} onVote={onVote} onReply={onReply} depth={depth + 1} />)}</div>}
  </article>;
}

/** 间贴树 UI，包含根节点排序、乐观赞踩和本地回复演示。 */
export function CommentThread({ identity, initial = seedComments, compact = false }: { identity: SeedIdentity; initial?: CommentReply[]; compact?: boolean }) {
  const [comments, setComments] = useState<CommentReply[]>(initial);
  const [sort, setSort] = useState<SortMode>('score');
  const [replyTo, setReplyTo] = useState<CommentReply | null>(null);
  const [body, setBody] = useState('');
  useEffect(() => { setComments(initial); }, [initial]);
  const sorted = useMemo(() => [...comments].sort((a, b) => sort === 'score' ? (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes) : Date.parse(b.createdAt) - Date.parse(a.createdAt)), [comments, sort]);
  const onVote = async (comment: CommentReply, vote: -1 | 0 | 1) => {
    const previous = comment.myVote;
    // 先更新整棵树获得即时反馈，再用服务端权威计数覆盖乐观值。
    setComments((current) => updateTree(current, comment.id, (item) => ({
      ...item,
      upvotes: item.upvotes - (previous === 1 ? 1 : 0) + (vote === 1 ? 1 : 0),
      downvotes: item.downvotes - (previous === -1 ? 1 : 0) + (vote === -1 ? 1 : 0),
      myVote: vote,
    })));
    try {
      const result = await voteComment(comment.id, vote);
      setComments((current) => updateTree(current, comment.id, (item) => ({ ...item, ...result })));
    } catch { /* 乐观值保持可见；宿主可自行展示网络状态。 */ }
  };
  const submit = () => {
    if (!body.trim()) return;
    const next: CommentReply = { id: createId('comment'), parentId: replyTo?.id ?? null, author: identity, body: body.trim(), createdAt: new Date().toISOString(), upvotes: 0, downvotes: 0, myVote: 0, children: [] };
    // parentId 决定插入楼中楼还是根列表；真实持久化由未来 CommentAdapter 接管。
    if (replyTo) setComments((current) => updateTree(current, replyTo.id, (item) => ({ ...item, children: [...item.children, next] })));
    else setComments((current) => [next, ...current]);
    setBody(''); setReplyTo(null);
  };
  return <section aria-label="间贴回复">
    <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><MessageCircle size={15} className="text-primary" /><strong className="text-sm">间贴</strong><span className="text-xs text-muted-foreground">{comments.length}</span></div><div className="inline-flex rounded border border-border p-0.5"><button type="button" className={`h-7 rounded px-2 text-[11px] ${sort === 'score' ? 'bg-muted font-bold' : 'text-muted-foreground'}`} onClick={() => setSort('score')}>按赞</button><button type="button" className={`h-7 rounded px-2 text-[11px] ${sort === 'recent' ? 'bg-muted font-bold' : 'text-muted-foreground'}`} onClick={() => setSort('recent')}>最新</button></div></div>
    <div className={compact ? 'max-h-[56vh] overflow-auto pr-1' : ''}><div className="comment-tree">{sorted.map((comment) => <CommentNode key={comment.id} comment={comment} onVote={onVote} onReply={setReplyTo} />)}</div></div>
    <div className="mt-4 border-t border-border pt-3">{replyTo && <div className="mb-2 flex items-center justify-between rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"><span>回复 {replyTo.author.name}</span><button onClick={() => setReplyTo(null)} aria-label="取消回复">×</button></div>}<div className="flex items-end gap-2"><textarea value={body} onChange={(event) => setBody(event.target.value)} className="field-area min-h-[68px] flex-1 resize-none" placeholder="写一条间贴…" aria-label="间贴内容" /><Button size="icon" onClick={submit} disabled={!body.trim()} aria-label="发送间贴"><Send size={16} /></Button></div></div>
  </section>;
}
