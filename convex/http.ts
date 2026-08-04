import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Auth needs its /.well-known endpoints at the root, so we use app-owned
// root routing: exact routes (auth) win over the static catch-all.
auth.addHttpRoutes(http);
registerStaticRoutes(http, components.staticHosting);

export default http;
