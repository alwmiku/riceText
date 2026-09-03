import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDemoAuthHeaderEnabled } from './api/client';
import { defaultDocument, seedComments, seedRevisions, seedSuggestions } from './seed';
import {
  ApiError,
  createDice,
  getCommentThread,
  getDocument,
  getRevision,
  getRevisions,
  listDocuments,
  listForumChapters,
  listSuggestions,
  restoreRevision,
  saveDocument,
  saveDocumentSteps,
  submitSuggestion,
  uploadAsset,
  uploadLongTextChapter,
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
    vi.unstubAllEnvs();
  });

  it('显式关闭 demo 模式时不启用身份请求头', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_DEMO_AUTH', 'false');
    expect(isDemoAuthHeaderEnabled()).toBe(false);
  });

  it('读取文章选择列表并按文档查询章节', async () => {
    const article = {
      id: 'demo-post',
      title: '测试文章',
      revision: 2,
      savedAt: '2026-09-03T00:00:00.000Z',
      canEdit: true,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [article] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    await expect(listDocuments()).resolves.toEqual([article]);
    await expect(listForumChapters('demo-post')).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/documents');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/forum/chapters?documentId=demo-post',
    );
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
    // GET 请求不携带 body，类型化客户端不设置 Content-Type
    expect(new Headers(init.headers).get('content-type')).toBeNull();
  });

  it('读取指定历史版本正文', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...defaultDocument, revision: 7 }),
    );
    const result = await getRevision('demo-post', 7);
    expect(result.revision).toBe(7);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/demo-post/revisions/7',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('读取失败时优先返回本地副本，否则返回空白缺失状态', async () => {
    const cached = { ...defaultDocument, revision: 33, storage: 'local-cache' as const };
    localStorage.setItem('ricetext:document:cached', JSON.stringify(cached));
    fetchMock.mockRejectedValue(new TypeError('offline'));

    await expect(getDocument('cached')).resolves.toEqual(cached);
    await expect(getDocument('missing')).resolves.toMatchObject({
      id: 'missing',
      storage: 'missing',
      content: { type: 'doc', content: [] },
    });
  });

  it('服务器明确返回 404 时返回空白缺失状态而不是演示文章', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'DOCUMENT_NOT_FOUND', message: '文档不存在' } },
        { status: 404 },
      ),
    );
    await expect(getDocument('empty-post')).resolves.toMatchObject({
      id: 'empty-post',
      title: '未命名文章',
      revision: 0,
      storage: 'missing',
      content: { type: 'doc', content: [] },
    });
  });

  it('Pages 将 API 路径误回退为 HTML 时不展示演示文章', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      }),
    );

    await expect(getDocument('demo-post')).resolves.toMatchObject({
      id: 'demo-post',
      storage: 'missing',
      content: { type: 'doc', content: [] },
    });
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

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'REVISION_CONFLICT', message: '版本已经变化', details: { latestRevision: 20 } } },
        { status: 409 },
      ),
    );
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

  it('上传最小 steps：PATCH 成功、409 抛出、离线本地应用并缓存', async () => {
    const steps = [
      {
        stepType: 'replace',
        from: 1,
        to: 1,
        slice: { content: [{ type: 'text', text: '新' }], openStart: 0, openEnd: 0 },
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...defaultDocument, revision: 19 }));
    const saved = await saveDocumentSteps('demo-post', {
      schemaVersion: 1,
      baseRevision: 18,
      clientMutationId: 'steps_1',
      steps,
      chapterId: 'chapter-0',
    });
    expect(saved).toMatchObject({ revision: 19, storage: 'server' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/demo-post/steps',
      expect.objectContaining({ method: 'PATCH' }),
    );
    const init = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      baseRevision: 18,
      steps,
      chapterId: 'chapter-0',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '版本已经变化' }, { status: 409 }));
    await expect(
      saveDocumentSteps('demo-post', { schemaVersion: 1, baseRevision: 18, clientMutationId: 'steps_2', steps }),
    ).rejects.toMatchObject({ status: 409 });

    // 离线：已有本地基线时应用 steps 后整篇缓存；无缓存不再偷偷使用演示正文。
    localStorage.setItem(
      'ricetext:document:demo-post',
      JSON.stringify({ ...defaultDocument, storage: 'local-cache' }),
    );
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const offline = await saveDocumentSteps('demo-post', {
      schemaVersion: 1,
      baseRevision: 18,
      clientMutationId: 'steps_3',
      steps: [{ stepType: 'replace', from: 1, to: 1, slice: { content: [{ type: 'text', text: '海' }], openStart: 0, openEnd: 0 } }],
    });
    expect(offline).toMatchObject({ revision: 19, storage: 'local-cache' });
    const cached = JSON.parse(localStorage.getItem('ricetext:document:demo-post')!) as { content: { content: Array<{ content: Array<{ text: string }> }> } };
    // 首段首字符被替换为“海”
    expect(cached.content.content[0]!.content[0]!.text.startsWith('海')).toBe(true);
  });

  it('读取版本支持服务器、网络回退和 HTTP 错误', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: seedRevisions.slice(0, 1) }));
    await expect(getRevisions('demo-post')).resolves.toEqual(seedRevisions.slice(0, 1));

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(getRevisions('demo-post')).resolves.toBe(seedRevisions);

    // 服务不可用（代理 502/503）与断网等价，同样降级到本地历史
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 503 }));
    await expect(getRevisions('demo-post')).resolves.toBe(seedRevisions);

    // 业务错误（如权限不足）必须向上抛出
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'FORBIDDEN', message: '无权访问' } }, { status: 403 }),
    );
    await expect(getRevisions('demo-post')).rejects.toMatchObject({ status: 403, message: '无权访问' });
  });

  it('校订建议：服务可用时读取列表，502/503 时回退种子数据，业务错误抛出', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await expect(listSuggestions('demo-post')).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 502 }));
    await expect(listSuggestions('demo-post')).resolves.toEqual(seedSuggestions);

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '文档不存在' }, { status: 404 }));
    await expect(listSuggestions('demo-post')).rejects.toMatchObject({ status: 404 });
  });

  it('提交校订建议时携带章节和行定位', async () => {
    const created = seedSuggestions[0]!;
    fetchMock.mockResolvedValueOnce(jsonResponse(created, { status: 201 }));
    const input = {
      fromText: '正好',
      toText: '恰好',
      reason: '避免重复',
      chapterId: 'chapter-0',
      chapterTitle: '正文',
      lineNo: 4,
      lineText: '灯塔正好熄灭。',
    };

    await expect(submitSuggestion('demo-post', input)).resolves.toEqual(created);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/forum/documents/demo-post/suggestions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    );
  });

  it('章节目录在服务不可用时降级为空数组', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 502 }));
    await expect(listForumChapters('demo-post')).resolves.toEqual([]);
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

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'INVALID_DICE_EXPRESSION', message: '服务端拒绝' } }, { status: 422 }),
    );
    await expect(createDice('3d5')).rejects.toMatchObject({ status: 422, message: '服务端拒绝' });
  });

  it('上传图片成功时不设置 JSON Content-Type，网络失败时生成对象 URL', async () => {
    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    const uploaded = { assetId: 'asset_1', url: '/uploads/cover.png', name: 'cover.png', mimeType: 'image/png', size: 5 };
    fetchMock.mockResolvedValueOnce(jsonResponse(uploaded));
    await expect(uploadAsset(file)).resolves.toEqual(uploaded);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('x-user-id')).toBe('author');
    // multipart 请求不设置 JSON Content-Type，让浏览器生成 boundary
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('content-type')).toBeNull();

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const createObjectURL = vi.fn(() => 'blob:cover');
    vi.stubGlobal('URL', { ...URL, createObjectURL });
    await expect(uploadAsset(file)).resolves.toMatchObject({ url: 'blob:cover', name: 'cover.png' });
    expect(createObjectURL).toHaveBeenCalledWith(file);
  });

  it('上传 HTTP 失败和超大离线文件均返回可识别错误', async () => {
    const file = new File(['x'], 'bad.png', { type: 'image/png' });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'ASSET_TOO_LARGE', message: '图片超过大小限制' } }, { status: 413 }),
    );
    await expect(uploadAsset(file)).rejects.toMatchObject({ status: 413, message: '图片超过大小限制' });

    const huge = { name: 'huge.png', type: 'image/png', size: 8 * 1024 * 1024 + 1 } as File;
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(uploadAsset(huge)).rejects.toMatchObject({ status: 422, message: '上传限制为 8 MB' });
  });

  it('长文本章节上传保留服务端冲突代码', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'CHAPTER_REVISION_CONFLICT',
            message: '章节已被其他修改更新',
            details: { currentRevision: 5 },
          },
        },
        { status: 409 },
      ),
    );

    await expect(
      uploadLongTextChapter('article-a', 'chapter-a', {
        title: '第一章',
        order: 0,
        content: { type: 'doc', content: [] },
        hash: 'a'.repeat(64),
        baseRevision: 4,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'CHAPTER_REVISION_CONFLICT',
      details: { currentRevision: 5 },
    });
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
