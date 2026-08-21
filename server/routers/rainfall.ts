import { z } from "zod";
import { PALESTINIAN_CITIES, getRainfallSeries } from "../rainfall";
import { publicProcedure, router } from "../_core/trpc";

const granularitySchema = z.enum(["daily", "monthly", "annual"]);

export const rainfallRouter = router({
  catalog: publicProcedure.query(() => PALESTINIAN_CITIES),
  series: publicProcedure
    .input(
      z.object({
        cityId: z.string().min(1),
        granularity: granularitySchema,
        year: z.number().int().min(2000).max(2026).optional(),
        month: z.number().int().min(1).max(12).optional(),
        seasonStartYear: z.number().int().min(2000).max(2025).optional(),
      })
    )
    .query(({ input }) => getRainfallSeries(input)),
});
