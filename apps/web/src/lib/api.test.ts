import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDocument, seedComments, seedRevisions } from './seed';
import {
  ApiError,
  createDice,
  getCommentThread,
  getDocument,
  getRevisions,
  restoreRevision,
  saveDocument,
  uploadAsset,
  voteComment,
} from './api';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('web api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('读取服务器文档并携带当前论坛身份与中止信号', async () => {
    localStorage.setItem('ricetext:identity', 'user_reader');
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(jsonResponse(defaultDocument));

    const result = await getDocument('post/a b', controller.signal);

    expect(result).toMatchObject({ id: 'demo-post', storage: 'server' });
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/post/a b', expect.objectContaining({ signal: controller.signal }));
    const init = fetchMock.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get('x-user-id')).toBe('reader');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('读取失败时优先返回本地副本，其次返回种子文档', async () => {
    const cached = { ...defaultDocument, revision: 33, storage: 'local-cache' as const };
    localStorage.setItem('ricetext:document:cached', JSON.stringify(cached));
    fetchMock.mockRejectedValue(new TypeError('offline'));

    await expect(getDocument('cached')).resolves.toEqual(cached);
    await expect(getDocument('missing')).resolves.toBe(defaultDocument);
  });

  it('Pages 将不存在的 API 路径回退为 HTML 时使用种子文档', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      }),
    );

    await expect(getDocument('demo-post')).resolves.toBe(defaultDocument);
  });

  it('不会把 AbortError 降级成本地文档', async () => {
    const aborted = new DOMException('aborted', 'AbortError');
    fetchMock.mockRejectedValueOnce(aborted);
    await expect(getDocument('demo-post')).rejects.toBe(aborted);
  });

  it('保存成功发送固定契约，409 则保留 ApiError 详情', async () => {
    const input = { schemaVersion: 1, baseRevision: 18, clientMutationId: 'mutation_1', content: defaultDocument.content };
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...defaultDocument, revision: 19 }));

    await expect(saveDocument('demo-post', input)).resolves.toMatchObject({ revision: 19 });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/documents/demo-post', expect.objectContaining({ method: 'PUT', body: JSON.stringify(input) }));

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '版本已经变化', latestRevision: 20 }, { status: 409 }));
    const error = await saveDocument('demo-post', input).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: '版本已经变化', status: 409, details: { latestRevision: 20 } });
  });

  it('网络不可达时保存本地缓存副本并递增较新的修订号', async () => {
    const cached = { ...defaultDocument, revision: 24 };
    localStorage.setItem('ricetext:document:demo-post', JSON.stringify(cached));
    fetchMock.mockRejectedValue(new TypeError('offline'));

    const result = await saveDocument('demo-post', {
      schemaVersion: 1,
      baseRevision: 20,
      clientMutationId: 'local_1',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });

    expect(result).toMatchObject({ revision: 25, storage: 'local-cache' });
    expect(JSON.parse(localStorage.getItem('ricetext:document:demo-post')!)).toMatchObject({ revision: 25, storage: 'local-cache' });
  });

  it('读取版本支持服务器、网络回退和 HTTP 错误', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: seedRevisions.slice(0, 1) }));
    await expect(getRevisions('demo-post')).resolves.toEqual(seedRevisions.slice(0, 1));

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(getRevisions('demo-post')).resolves.toBe(seedRevisions);

    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 503 }));
    await expect(getRevisions('demo-post')).rejects.toMatchObject({ status: 503, message: '请求失败 (503)' });
  });

  it('按契约回滚指定版本', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...defaultDocument, revision: 19 }));
    await restoreRevision('demo-post', 12, 18);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ targetRevision: 12, baseRevision: 18 });
    expect(JSON.parse(String(init?.body)).clientMutationId).toMatch(/^restore_/);
  });

  it('骰子优先使用服务端结果，离线时稳定生成合法结果', async () => {
    const serverRoll = { rollId: 'roll_server', expression: '1d20+2', rolls: [18], total: 20, rerollOf: null };
    fetchMock.mockResolvedValueOnce(jsonResponse(serverRoll));
    await expect(createDice('1d20+2')).resolves.toEqual(serverRoll);

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    await expect(createDice(' 2d6-1 ', 'roll_old')).resolves.toMatchObject({ expression: ' 2d6-1 ', rolls: [3, 3], total: 5, rerollOf: 'roll_old' });
  });

  it('骰子拒绝无效表达式和越界参数，并透传服务端校验错误', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(createDice('not-dice')).rejects.toMatchObject({ status: 422 });

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(createDice('51d6')).rejects.toMatchObject({ status: 422, message: '骰子数量或面数超出范围' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '服务端拒绝' }, { status: 422 }));
    await expect(createDice('3d5')).rejects.toMatchObject({ status: 422, message: '服务端拒绝' });
  });

  it('上传图片成功时不设置 JSON Content-Type，网络失败时生成对象 URL', async () => {
    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    const uploaded = { assetId: 'asset_1', url: '/uploads/cover.png', name: 'cover.png', mimeType: 'image/png', size: 5 };
    fetchMock.mockResolvedValueOnce(jsonResponse(uploaded));
    await expect(uploadAsset(file)).resolves.toEqual(uploaded);
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({ 'x-user-id': 'author' });

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const createObjectURL = vi.fn(() => 'blob:cover');
    vi.stubGlobal('URL', { ...URL, createObjectURL });
    await expect(uploadAsset(file)).resolves.toMatchObject({ url: 'blob:cover', name: 'cover.png' });
    expect(createObjectURL).toHaveBeenCalledWith(file);
  });

  it('上传 HTTP 失败和超大离线文件均返回可识别错误', async () => {
    const file = new File(['x'], 'bad.png', { type: 'image/png' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 413 }));
    await expect(uploadAsset(file)).rejects.toMatchObject({ status: 413, message: '图片上传失败' });

    const huge = { name: 'huge.png', type: 'image/png', size: 8 * 1024 * 1024 + 1 } as File;
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(uploadAsset(huge)).rejects.toMatchObject({ status: 422, message: '上传限制为 8 MB' });
  });

  it('间贴读取与赞踩覆盖服务器和离线回退', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: seedComments.slice(0, 1) }));
    await expect(getCommentThread('doc', 'thread')).resolves.toEqual(seedComments.slice(0, 1));

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const fallback = await getCommentThread('doc', 'thread');
    expect(fallback).toEqual(seedComments);
    expect(fallback).not.toBe(seedComments);

    fetchMock.mockResolvedValueOnce(jsonResponse({ upvotes: 4, downvotes: 1, myVote: -1 }));
    await expect(voteComment('comment_1', -1)).resolves.toEqual({ upvotes: 4, downvotes: 1, myVote: -1 });

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(voteComment('comment_1', 1)).resolves.toEqual({ upvotes: 9, downvotes: 0, myVote: 1 });
  });
});
