import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("D1 迁移触发器避免远端分句器不支持的嵌套 CASE 语句", () => {
  let triggers = 0;
  for (const migration of env.TEST_MIGRATIONS) {
    for (const query of migration.queries) {
      // 迁移读取器已去除注释；忽略字符串和双引号标识符，避免误报其中的关键字。
      const sql = query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, "");
      if (!/\bCREATE\s+TRIGGER\b/i.test(sql)) continue;
      triggers += 1;
      expect(
        sql,
        `${migration.name}：触发器条件检查应使用 SELECT RAISE(...) WHERE ...，避免嵌套 CASE ... END。`,
      ).not.toMatch(/\bCASE\b/i);
    }
  }
  expect(triggers).toBeGreaterThan(0);
});
