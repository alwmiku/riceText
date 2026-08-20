import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DiceRoll } from "@dice-roller/rpg-dice-roller";
import type { DiceRollResult } from "@ricetext/contracts";
import { HttpError } from "./errors.js";

interface DiceRow { id: string; root_roll_id: string; previous_roll_id: string | null; expression: string; details_json: string; total: number; created_at: string; }

function extractRolls(value: unknown): number[] {
  const results: number[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    if (record.type === "result" && typeof record.value === "number") { results.push(record.value); return; }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return results;
}

/** 持久化骰子服务；读取不会触发投掷。 */
export class DiceService {
  readonly #db: DatabaseSync;
  /** 绑定 API 数据库。 */
  constructor(db: DatabaseSync) { this.#db = db; }

  /** 解析表达式、投掷一次并保存。 */
  create(expression: string, userId: string): DiceRollResult { return this.#roll(expression, userId, null, null); }

  /** 只读取数据库中的固定结果。 */
  get(rollId: string): DiceRollResult {
    const row = this.#db.prepare("SELECT id, root_roll_id, previous_roll_id, expression, details_json, total, created_at FROM dice_rolls WHERE id = ?").get(rollId) as unknown as DiceRow | undefined;
    if (!row) throw new HttpError(404, "DICE_ROLL_NOT_FOUND", "骰子结果不存在");
    return this.#map(row);
  }

  /** 显式重投并保留 root/previous 链。 */
  reroll(rollId: string, userId: string): DiceRollResult {
    const previous = this.get(rollId);
    return this.#roll(previous.expression, userId, previous.rootRollId, previous.rollId);
  }

  #roll(expression: string, userId: string, rootRollId: string | null, previousRollId: string | null): DiceRollResult {
    let roll: DiceRoll;
    try { roll = new DiceRoll(expression); }
    catch { throw new HttpError(422, "INVALID_DICE_EXPRESSION", "骰子表达式不可解析，例如可使用 3d5"); }
    const id = randomUUID();
    const root = rootRollId ?? id;
    const now = new Date().toISOString();
    const rolls = extractRolls(roll.toJSON());
    this.#db.prepare("INSERT INTO dice_rolls(id, root_roll_id, previous_roll_id, expression, details_json, total, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, root, previousRollId, expression, JSON.stringify(rolls), roll.total, userId, now);
    return { rollId: id, rootRollId: root, rerollOf: previousRollId, expression, rolls, total: roll.total, createdAt: now };
  }

  #map(row: DiceRow): DiceRollResult {
    return { rollId: row.id, rootRollId: row.root_roll_id, rerollOf: row.previous_roll_id, expression: row.expression, rolls: JSON.parse(row.details_json) as number[], total: row.total, createdAt: row.created_at };
  }
}
