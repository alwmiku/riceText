import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { buildOpenApiDocument } from "./openapi.js";

/** 将当前共享契约写为 OpenAPI YAML；默认输出到仓库 docs 目录。 */
export async function writeOpenApi(
  outputDirectory = resolve(import.meta.dirname, "../../../docs"),
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, "openapi.yaml"),
    stringify(buildOpenApiDocument(), { lineWidth: 120 }),
    "utf8",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await writeOpenApi();
}
