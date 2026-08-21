import "dotenv/config";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express } from "express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";

/**
 * Builds the API half of the app: body parsers, storage proxy, OAuth and tRPC.
 * Static/Vite serving is intentionally left out so this can run both under a
 * long-lived node process and inside a Netlify function.
 */
export function createApiApp(): Express {
  const app = express();
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  return app;
}
