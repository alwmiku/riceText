import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { featureDependencyBaseline } from "./dependency-rules.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const eslint = new ESLint({ cwd: root });
const ruleId = "architecture/dependency-boundaries";
const pure = "apps/web/src/features/compose/chapter-upload-plan.ts";
const core = "packages/document-core/src/architecture-example.ts";

async function violations(filePath, code) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, filePath),
  });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages
    .filter((message) => message.ruleId === ruleId)
    .map((message) => message.messageId);
}

// 通过真实根配置运行，防止规则存在但未应用到目标文件。
for (const filePath of [
  pure,
  "apps/web/src/features/compose/chapter-upload-domain.ts",
  "apps/web/src/features/compose/chapter-upload-checkpoint.ts",
  "apps/web/src/features/compose/long-text-workspace-projections.ts",
  "apps/web/src/lib/chapter-source.ts",
  "apps/web/src/lib/document-content.ts",
  "apps/web/src/lib/chapter-query-keys.ts",
]) {
  test("纯领域规则覆盖 " + filePath, async () => {
    assert.deepEqual(
      await violations(filePath, 'import type { ReactNode } from "react";'),
      ["pureUi"],
    );
  });
}

for (const [label, code] of [
  ["相对组件路径", 'import { Button } from "../../components/ui/button";'],
  ["@ 别名", 'export { Button } from "@/components/ui/button";'],
  [
    "类型重导出",
    'export type { CoverageChapter } from "../novel/ChapterCoverageDialog";',
  ],
  ["类型查询", 'type Props = import("react").ReactNode;'],
  ["动态导入", 'void import("@tiptap/react");'],
  [
    "静态模板导入",
    "void import(" +
      String.fromCharCode(96) +
      "react/jsx-runtime" +
      String.fromCharCode(96) +
      ");",
  ],
  ["require 导入", 'const ui = require("@ricetext/editor-core");'],
  ["TypeScript require 导入", 'import ui = require("@ricetext/editor-core");'],
  [
    "同功能模块UI hook",
    'import { useChapterUpload } from "./useChapterUpload";',
  ],
]) {
  test("纯领域禁止 UI：" + label, async () => {
    assert.ok((await violations(pure, code)).includes("pureUi"));
  });
}

test("纯领域可消费领域类型、契约和 document-core", async () => {
  assert.deepEqual(
    await violations(
      pure,
      [
        'import type { ChapterUploadPlan } from "./chapter-upload-domain";',
        'import type { TiptapDocument } from "@ricetext/contracts";',
        'import { convertLongTextBlocksToChapters } from "@ricetext/document-core";',
      ].join(" "),
    ),
    [],
  );
});

for (const specifier of [
  "react",
  "react-dom/server",
  "@ricetext/editor-core",
  "@ricetext/web",
  "@ricetext/api",
  "@ricetext/worker/repositories/write-repository",
  "../../../apps/api/src/document-service",
  "../../../apps/worker/src/env",
  "@/lib/types",
  "hono",
  "fastify",
  "node:sqlite",
  "fs",
  "http",
  "cloudflare:workers",
  "@cloudflare/workers-types",
]) {
  for (const filePath of [
    core,
    "packages/server-core/src/architecture-example.ts",
  ]) {
    test(filePath + " 禁止平台依赖 " + specifier, async () => {
      assert.ok(
        (
          await violations(
            filePath,
            "export * from " + JSON.stringify(specifier) + ";",
          )
        ).includes("corePlatform"),
      );
    });
  }
}

test("核心包可依赖共享契约、ProseMirror 和 document-core", async () => {
  assert.deepEqual(
    await violations(
      "packages/server-core/src/architecture-example.ts",
      [
        'import type { TiptapDocument } from "@ricetext/contracts";',
        'import { sanitizeDocument } from "@ricetext/document-core";',
        'import type { Node } from "@tiptap/pm/model";',
      ].join(" "),
    ),
    [],
  );
});

const feature = "apps/web/src/features/compose/new-workspace.ts";
for (const code of [
  'import { RichTextEditor } from "../editor/RichTextEditor";',
  'export type { ChapterSummary } from "@/features/novel/ChapterSidebar";',
  'export * from "../editor/./hooks/../RichTextEditor";',
  'void import("../editor/RichTextEditor");',
  'const editor = require("../editor/RichTextEditor");',
]) {
  test("新跨功能模块内部依赖失败：" + code, async () => {
    assert.deepEqual(await violations(feature, code), ["featureInternal"]);
  });
}

test("别名中的路径回退不能伪装为同功能模块依赖", async () => {
  assert.deepEqual(
    await violations(
      "apps/web/src/features/editor/controller.ts",
      'import type { ChapterSummary } from "@/features/editor/../novel/ChapterSidebar.js";',
    ),
    ["featureInternal"],
  );
  assert.deepEqual(
    await violations(
      pure,
      'type Props = import("@/features/compose/../novel/ChapterSidebar").ChapterSummary;',
    ),
    ["pureUi", "featureInternal"],
  );
});

test("基线只允许原文件到原目标，不能扩张到同功能模块新文件或新目标", async () => {
  const existing = "apps/web/src/features/compose/useComposeDocument.ts";
  assert.deepEqual(
    await violations(
      existing,
      'import { useAutosave } from "../editor/hooks/useAutosave";',
    ),
    [],
  );
  assert.deepEqual(
    await violations(
      feature,
      'import { useAutosave } from "../editor/hooks/useAutosave";',
    ),
    ["featureInternal"],
  );
  assert.deepEqual(
    await violations(
      existing,
      'import { RichTextEditor } from "../editor/RichTextEditor";',
    ),
    ["featureInternal"],
  );
});

test("页面可组合内部模块，同功能模块与根公开入口可引用", async () => {
  const code =
    'import { RichTextEditor } from "@/features/editor/RichTextEditor";';
  assert.deepEqual(
    await violations("apps/web/src/pages/NewPage.tsx", code),
    [],
  );
  assert.deepEqual(
    await violations("apps/web/src/features/editor/new-controller.ts", code),
    [],
  );
  assert.deepEqual(
    await violations(
      "apps/web/src/features/editor/index.ts",
      'export { RichTextEditor } from "./RichTextEditor";',
    ),
    [],
  );
  assert.deepEqual(
    await violations(
      feature,
      'import { Editor } from "@/features/editor/index";',
    ),
    [],
  );
  assert.deepEqual(await violations("apps/web/src/lib/new-helper.ts", code), [
    "featureInternal",
  ]);
});

test("当前受约束源码无新增越界依赖", async () => {
  const results = await eslint.lintFiles([
    "apps/web/src/**/*.{ts,tsx}",
    "packages/document-core/src/**/*.{ts,tsx}",
    "packages/server-core/src/**/*.{ts,tsx}",
  ]);
  const errors = results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === ruleId || message.fatal)
      .map(
        (message) =>
          path.relative(root, result.filePath) +
          ":" +
          message.line +
          " " +
          message.message,
      ),
  );
  assert.deepEqual(errors, []);
});

test("精确基线不重复、不包含已移除的依赖", async () => {
  const keys = featureDependencyBaseline.map((pair) => pair.join(" -> "));
  assert.equal(new Set(keys).size, keys.length);
  for (const [from, to] of featureDependencyBaseline) {
    const base = path.join(root, "apps/web/src/features", from);
    const code = await readFile(base + ".ts", "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return readFile(base + ".tsx", "utf8");
    });
    const tree = ts.createSourceFile(
      base + ".tsx",
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const imports = tree.statements
      .filter(
        (node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node),
      )
      .map((node) => node.moduleSpecifier?.text)
      .filter((value) => typeof value === "string")
      .map((specifier) =>
        specifier.startsWith("@/features/")
          ? specifier.slice("@/features/".length)
          : path.posix.normalize(
              path.posix.join(path.posix.dirname(from), specifier),
            ),
      )
      .map((value) =>
        value.replace(/\.(?:[jt]sx?)$/, "").replace(/\/index$/, ""),
      );
    assert.ok(imports.includes(to), "移除过期基线：" + from + " -> " + to);
  }
});
