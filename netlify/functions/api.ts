import serverless from "serverless-http";
import { createApiApp } from "../../server/_core/app";

// ponytail: one function fronts the whole Express API. Split per-route only if
// cold starts or the function time budget actually become a problem.
const wrapped = serverless(createApiApp());

export const handler = async (event: any, context: any) => {
  // Depending on how the function is reached, Netlify sets `event.path` to
  // either the original request path or the /.netlify/functions/api one.
  // `rawUrl` is always the real request URL, so the Express routes get the
  // path they were written against (/api/trpc/*, /manus-storage/*).
  if (event?.rawUrl) {
    event.path = new URL(event.rawUrl).pathname;
  }
  return wrapped(event, context);
};
