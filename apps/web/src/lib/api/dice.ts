import { createId } from "../utils";
import type { DiceResult } from "../types";
import { ApiError, api, isApiClientError, rethrowClientError } from "./client";

export async function createDice(
  expression: string,
  rerollOf: string | null = null,
): Promise<DiceResult> {
  try {
    return await api().createDice(expression, rerollOf ?? undefined);
  } catch (error) {
    if (isApiClientError(error)) rethrowClientError(error);
    const match = /^(\d{1,2})d(\d{1,4})(?:([+-])([0-9]{1,4}))?$/i.exec(
      expression.replace(/\s/g, ""),
    );
    if (!match) throw new ApiError("请输入例如 3d5、1d20+2 的骰子表达式", 422);
    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || count > 50 || sides < 2 || sides > 1000)
      throw new ApiError("骰子数量或面数超出范围", 422);
    const rolls = Array.from(
      { length: count },
      () => Math.floor(Math.random() * sides) + 1,
    );
    const modifier = match[3] ? Number(`${match[3]}${match[4]}`) : 0;
    return {
      rollId: createId("roll"),
      expression,
      rolls,
      total: rolls.reduce((sum, value) => sum + value, modifier),
      rerollOf,
    };
  }
}
