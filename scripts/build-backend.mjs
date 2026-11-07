import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const output=path.join(root,"backend","dist");
await mkdir(output,{recursive:true});

await build({
  absWorkingDir:root,
  entryPoints:["backend/src/market-data-engine.ts"],
  outfile:"backend/dist/market-data-engine.mjs",
  bundle:true,
  platform:"node",
  format:"esm",
  target:"node22",
  alias:{"@":path.join(root,"src")},
  sourcemap:false,
  legalComments:"none",
  logLevel:"info",
});
await build({
  absWorkingDir:root,
  entryPoints:["backend/src/opportunity-engine.ts"],
  outfile:"backend/dist/opportunity-engine.mjs",
  bundle:true,
  platform:"node",
  format:"esm",
  target:"node22",
  alias:{"@":path.join(root,"src")},
  sourcemap:false,
  legalComments:"none",
  logLevel:"info",
});
console.info("Built self-hosted market-data and autonomous opportunity engines.");
