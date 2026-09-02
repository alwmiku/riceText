import { DiceRoll } from "@dice-roller/rpg-dice-roller";
import { DiceRollSchema, type DiceRollResult } from "@ricetext/contracts";
import { WorkerHttpError } from "../http-error";

type DiceRow = {
  id: string;
  root_roll_id: string;
  previous_roll_id: string | null;
  expression: string;
  details_json: string;
  total: number;
  created_at: string;
};

function extractRolls(value: unknown): number[] {
  const results: number[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    if (record.type === "result" && typeof record.value === "number") {
      results.push(record.value);
      return;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return results;
}

/** 骰子结果只在创建或显式重投时计算，读取始终返回已持久化结果。 */
export class D1DiceRepository {
  constructor(private readonly db: D1Database) {}

  async get(rollId: string): Promise<DiceRollResult> {
    const row = await this.db
      .prepare(
        "SELECT id, root_roll_id, previous_roll_id, expression, details_json, total, created_at " +
          "FROM dice_rolls WHERE id = ?",
      )
      .bind(rollId)
      .first<DiceRow>();
    if (!row) throw new WorkerHttpError(404, "DICE_ROLL_NOT_FOUND", "骰子结果不存在");
    return DiceRollSchema.parse({
      rollId: row.id,
      rootRollId: row.root_roll_id,
      rerollOf: row.previous_roll_id,
      expression: row.expression,
      rolls: JSON.parse(row.details_json),
      total: Number(row.total),
      createdAt: row.created_at,
    });
  }

  async create(
    expression: string,
    userId: string,
    previousRollId: string | null = null,
  ): Promise<DiceRollResult> {
    let rootRollId: string | null = null;
    if (previousRollId) {
      const previous = await this.get(previousRollId);
      expression = previous.expression;
      rootRollId = previous.rootRollId;
    }
    let roll: DiceRoll;
    try {
      roll = new DiceRoll(expression);
    } catch {
      throw new WorkerHttpError(
        422,
        "INVALID_DICE_EXPRESSION",
        "骰子表达式不可解析，例如可使用 3d5",
      );
    }
    const id = crypto.randomUUID();
    const root = rootRollId ?? id;
    const createdAt = new Date().toISOString();
    const rolls = extractRolls(JSON.parse(JSON.stringify(roll.toJSON())));
    await this.db
      .prepare(
        "INSERT INTO dice_rolls(" +
          "id, root_roll_id, previous_roll_id, expression, details_json, total, created_by, created_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        root,
        previousRollId,
        expression,
        JSON.stringify(rolls),
        roll.total,
        userId,
        createdAt,
      )
      .run();
    return DiceRollSchema.parse({
      rollId: id,
      rootRollId: root,
      rerollOf: previousRollId,
      expression,
      rolls,
      total: roll.total,
      createdAt,
    });
  }
}
