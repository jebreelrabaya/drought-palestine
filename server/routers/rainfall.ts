import { FIRST_RAINY_SEASON_YEAR, currentRainySeasonStartYear } from "@shared/const";
import { z } from "zod";
import { PALESTINIAN_CITIES, datasetCoverage, getRainfallSeries } from "../rainfall";
import { publicProcedure, router } from "../_core/trpc";

const granularitySchema = z.enum(["daily", "monthly", "annual"]);

export const rainfallRouter = router({
  catalog: publicProcedure.query(() => PALESTINIAN_CITIES),
  coverage: publicProcedure.query(() => datasetCoverage()),
  series: publicProcedure
    .input(
      z.object({
        cityId: z.string().min(1),
        granularity: granularitySchema,
        year: z.number().int().min(FIRST_RAINY_SEASON_YEAR).max(currentRainySeasonStartYear() + 1).optional(),
        month: z.number().int().min(1).max(12).optional(),
        seasonStartYear: z.number().int().min(FIRST_RAINY_SEASON_YEAR).max(currentRainySeasonStartYear()).optional(),
      })
    )
    .query(({ input }) => getRainfallSeries(input)),
});
