/**
 * 转发到按节点拆分后的扩展模块，保持 `./extensions.js` 的既有导入路径兼容。
 * 节点与工厂实现见 `./extensions/` 目录。
 */
export * from "./extensions/index.js";
