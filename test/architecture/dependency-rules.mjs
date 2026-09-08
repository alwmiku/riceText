import { existsSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const web = "apps/web/src/";
const nodeBuiltins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);
const slash = (value) => value.replaceAll("\\", "/");
const modulePath = (value) =>
  path.posix
    .normalize(slash(value))
    .replace(/\.(?:[cm]?[jt]sx?)$/, "")
    .replace(/\/index$/, "");

/** 只保留本轮整理前已存在的文件依赖；不得使用功能模块或目录级通配豁免。 */
export const featureDependencyBaseline = [
  ["compose/StandardComposeWorkspace", "forum/ForumPanels"],
  ["compose/LongTextWorkspace", "novel/ChapterRawPreview"],
  ["compose/LongTextWorkspace", "novel/ChapterSidebar"],
  ["compose/LongTextWorkspace", "novel/ChapterCoverageDialog"],
  ["compose/LongTextWorkspace", "novel/ChapterUploadDialog"],
  ["compose/LongTextWorkspace", "novel/AddChapterDialog"],
  ["compose/useChapterUpload", "novel/raw-coverage"],
  ["compose/useComposeDocument", "editor/hooks/useAutosave"],
  ["compose/useLongTextWorkspace", "editor/long-text/long-text-import"],
  ["compose/useLongTextWorkspace", "editor/long-text/long-text-ids"],
  [
    "compose/useLongTextWorkspace",
    "editor/long-text/long-text-chapter-operations",
  ],
  [
    "compose/useLongTextEditorBuffer",
    "editor/long-text/long-text-chapter-operations",
  ],
  [
    "compose/long-text-workspace-projections",
    "editor/long-text/long-text-ranges",
  ],
  ["comparison/TextComparison", "proofread/char-diff"],
  ["forum/SuggestionPanel", "proofread/SuggestionBatchCard"],
  ["forum/SuggestionPanel", "proofread/suggestion-labels"],
  ["proofread/ChapterSuggestionEditor", "editor/RichTextEditor"],
  ["proofread/ProofreadView", "comparison/TextComparison"],
  // 展示层改为消费本轮抽离的领域类型，方向必须保持为 UI -> 领域。
  ["novel/ChapterCoverageDialog", "compose/chapter-upload-domain"],
  ["novel/ChapterUploadDialog", "compose/chapter-upload-domain"],
  ["novel/ChapterSidebar", "compose/long-text-workspace-projections"],
];
const baseline = new Set(
  featureDependencyBaseline.map(([from, to]) => from + " -> " + to),
);

/** 路径与别名统一后再判断边界，避免 ../ 或 @/ 写法绕开检查。 */
function targetPath(from, specifier) {
  if (specifier.startsWith("@/")) return modulePath(web + specifier.slice(2));
  if (specifier.startsWith(".")) {
    return modulePath(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(from), specifier),
      ),
    );
  }
  const workspace = /^@ricetext\/([^/]+)(?:\/(.*))?$/.exec(specifier);
  if (workspace) {
    const [, name, subpath = ""] = workspace;
    const directory = ["web", "api", "worker"].includes(name)
      ? "apps"
      : "packages";
    return modulePath(directory + "/" + name + "/src/" + subpath);
  }
  return null;
}

function isUi(specifier, target) {
  if (
    /^(?:react(?:-dom|-router(?:-dom)?|-window)?|lucide-react|@tiptap\/react|@tanstack\/react-[^/]+|@radix-ui\/[^/]+|@base-ui\/[^/]+|@testing-library\/react)(?:\/|$)/.test(
      specifier,
    )
  )
    return true;
  if (!target) return false;
  if (target.startsWith("packages/editor-core/")) return true;
  if (
    /^apps\/web\/src\/(?:components|pages|app|hooks)(?:\/|$)/.test(target) ||
    target === web + "app-context"
  )
    return true;
  if (/\/use[A-Z][^/]*$/.test(target)) return true;
  return (
    target.startsWith(web) &&
    [".tsx", ".jsx", "/index.tsx", "/index.jsx"].some((suffix) =>
      existsSync(path.join(root, target + suffix)),
    )
  );
}

function isBackend(specifier, target) {
  return (
    nodeBuiltins.has(specifier) ||
    /^(?:node:|cloudflare:|workerd:)/.test(specifier) ||
    /^(?:fastify|hono|express|wrangler|better-sqlite3|sqlite3|pg|mysql2|drizzle-orm|@prisma\/client|@cloudflare\/[^/]+)(?:\/|$)/.test(
      specifier,
    ) ||
    /^(?:apps\/(?:api|worker)(?:\/|$)|packages\/cloudflare-migration(?:\/|$))/.test(
      target ?? "",
    )
  );
}

function isPureWebModule(from) {
  return (
    /^apps\/web\/src\/features\/compose\/(?:chapter-upload-(?:domain|checkpoint|plan)|long-text-workspace-projections)$/.test(
      from,
    ) ||
    /^apps\/web\/src\/lib\/(?:chapter-source|document-content|chapter-query-keys)$/.test(
      from,
    )
  );
}

export const dependencyBoundaries = {
  meta: {
    type: "problem",
    docs: {
      description:
        "限制纯领域与核心包的依赖方向，并冻结页面外跨功能模块的既有内部依赖。",
    },
    schema: [],
    messages: {
      pureUi:
        "纯领域模块不得依赖 UI（包括类型导入）：{{specifier}}。请把共享类型或规则放入纯领域模块。",
      corePlatform:
        "document-core/server-core 不得依赖 Web、React 或具体后端：{{specifier}}。请由调用方适配。",
      featureInternal:
        "页面外不得新增跨功能模块内部依赖：{{from}} -> {{to}}。请使用功能模块根入口、共享领域模块或由页面组合。",
    },
  },
  create(context) {
    const from = modulePath(path.relative(root, context.filename));
    function check(node, source) {
      const specifier =
        source?.value ??
        (source?.type === "TemplateLiteral" && source.expressions.length === 0
          ? source.quasis[0].value.cooked
          : null);
      if (typeof specifier !== "string") return;
      const target = targetPath(from, specifier);
      if (isPureWebModule(from) && isUi(specifier, target)) {
        context.report({ node, messageId: "pureUi", data: { specifier } });
      }
      if (
        /^packages\/(?:document-core|server-core)\/src(?:\/|$)/.test(from) &&
        (isUi(specifier, target) ||
          target?.startsWith("apps/") ||
          isBackend(specifier, target))
      ) {
        context.report({
          node,
          messageId: "corePlatform",
          data: { specifier },
        });
      }
      if (!from.startsWith(web) || from.startsWith(web + "pages/")) return;
      const destination = target?.match(
        /^apps\/web\/src\/features\/([^/]+)\/(.+)$/,
      );
      if (!destination) return; // 功能模块根目录的 index 是显式公开入口。
      const origin = from.match(
        /^apps\/web\/src\/features\/([^/]+)(?:\/(.+))?$/,
      );
      if (origin?.[1] === destination[1]) return;
      const sourceFeaturePath = from.slice((web + "features/").length);
      const targetFeaturePath = destination[1] + "/" + destination[2];
      if (
        origin &&
        baseline.has(sourceFeaturePath + " -> " + targetFeaturePath)
      )
        return;
      context.report({
        node,
        messageId: "featureInternal",
        data: { from, to: target },
      });
    }
    return {
      ImportDeclaration(node) {
        check(node, node.source);
      },
      ExportNamedDeclaration(node) {
        check(node, node.source);
      },
      ExportAllDeclaration(node) {
        check(node, node.source);
      },
      ImportExpression(node) {
        check(node, node.source);
      },
      TSImportType(node) {
        check(node, node.source);
      },
      TSExternalModuleReference(node) {
        check(node, node.expression);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require")
          check(node, node.arguments[0]);
      },
    };
  },
};

export default { rules: { "dependency-boundaries": dependencyBoundaries } };
