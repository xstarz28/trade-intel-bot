import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { mcp } from "./mcp";

const http = httpRouter();

auth.addHttpRoutes(http);
mcp.registerRoutes(http);

export default http;
