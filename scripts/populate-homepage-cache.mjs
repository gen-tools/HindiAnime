import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const buildId = (await readFile(path.join(".next", "BUILD_ID"), "utf8")).trim();
const source = path.join(".open-next", "cache", buildId, "index.cache");
const destination = path.join(
  ".open-next",
  "assets",
  "cdn-cgi",
  "_next_cache",
  buildId,
  "index.cache",
);

await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);

console.log(`Prepared static homepage cache asset for build ${buildId}.`);
