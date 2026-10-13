import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const git = (args) =>
  execFileSync("git", args, { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
const staged = process.argv.includes("--staged");
const example = staged
  ? git(["show", ":.env.example"]).toString("utf8")
  : readFileSync(".env.example", "utf8");
for (const line of example.split(/\r?\n/)) {
  if (line.trim() && !line.trim().startsWith("#") && line.includes("=")) {
    const value = line
      .slice(line.indexOf("=") + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (value) {
      throw new Error(
        ".env.example must contain empty placeholders only; no credentials may be committed.",
      );
    }
  }
}
const secrets = [];
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line.trim().startsWith("#") && line.includes("=")) {
      const key = line.slice(0, line.indexOf("=")).trim();
      const value = line
        .slice(line.indexOf("=") + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (!key.startsWith("NEXT_PUBLIC_") && value) {
        secrets.push(Buffer.from(value));
      }
    }
  }
}
const paths = git(
  staged
    ? ["ls-files", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const path of paths) {
  if (path === ".env.local" || (path.startsWith(".env") && !path.endsWith(".example"))) {
    throw new Error("Private environment file is not ignored.");
  }
  const bytes = staged
    ? git(["show", `:${path}`])
    : existsSync(path)
      ? readFileSync(path)
      : null;
  if (bytes && secrets.some((secret) => bytes.includes(secret))) {
    throw new Error(`Private credential detected in ${path}; value suppressed.`);
  }
}
console.log(
  `PASS credential guard (${staged ? "complete Git index" : "working tree"}); no secret values printed.`,
);
