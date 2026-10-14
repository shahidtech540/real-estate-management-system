import { z } from "zod";
import { HttpError } from "@/server/auth/guards";
import { valid } from "../shared/domain";
export const planSchema = z
  .object({
    agentId: z.string().min(1).max(180),
    requestKey: z.string().trim().min(3).max(120),
    goal: z.string().trim().min(3).max(2000),
    maxCostMinor: z.number().int().nonnegative().max(1000000).default(0),
    steps: z
      .array(
        z
          .object({ tool: z.string().min(1).max(100), input: z.unknown() })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export interface PlanProvider {
  name: string;
  plan(input: unknown): {
    plan: z.output<typeof planSchema>;
    tokensUsed: number;
    costMinor: number;
    summary: string;
  };
}
/** Working local structured-plan adapter. No model invocation or hidden chain-of-thought. */
export function planningProvider(): PlanProvider {
  if ((process.env.AGENT_PROVIDER_MODE || "local") !== "local")
    throw new HttpError(
      503,
      "PROVIDER_NOT_CONFIGURED",
      "Live AI planning is not configured. No model or external service was called.",
    );
  return {
    name: "local-scripted",
    plan(input) {
      return {
        plan: valid(planSchema, input),
        tokensUsed: 0,
        costMinor: 0,
        summary:
          "Human-authored structured plan. Inputs and tool outputs are untrusted data, never executable instructions. No LLM cost incurred.",
      };
    },
  };
}
