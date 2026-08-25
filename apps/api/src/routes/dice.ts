import type { FastifyPluginAsync } from "fastify";
import { CreateDiceRollRequestSchema } from "@ricetext/contracts";
import type { RouteDependencies } from "./dependencies.js";
import { getFastifySchema, identity, params } from "./route-utils.js";

/** 服务端骰点、读取和重投路由。 */
export const diceRoutes: FastifyPluginAsync<RouteDependencies> = async (
  app,
  dependencies,
) => {
  app.post(
    "/api/dice",
    { schema: getFastifySchema("createDiceRoll") },
    async (request, reply) => {
      const body = CreateDiceRollRequestSchema.parse(request.body);
      const userId = identity(dependencies, request).id;
      return reply
        .status(201)
        .send(
          body.rerollOf
            ? dependencies.dice.reroll(body.rerollOf, userId)
            : dependencies.dice.create(body.expression, userId),
        );
    },
  );

  app.get(
    "/api/dice/:rollId",
    { schema: getFastifySchema("getDiceRoll") },
    async (request) => dependencies.dice.get(params(request).rollId!),
  );

  app.post(
    "/api/dice/:rollId/reroll",
    { schema: getFastifySchema("rerollDice") },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          dependencies.dice.reroll(
            params(request).rollId!,
            identity(dependencies, request).id,
          ),
        ),
  );
};
