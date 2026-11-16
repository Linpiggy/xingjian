// 用 XeLaTeX 编译技术文档：docs/latex/technical-doc.tex → docs/技术文档.pdf
// 依赖：TeX Live / TinyTeX（xelatex、xeCJK、tcolorbox、titlesec 等）与 Noto Serif CJK SC、思源黑体字体。
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "docs", "latex");
const source = "technical-doc.tex";

// 两遍：第二遍写入目录与页码
for (let pass = 1; pass <= 2; pass += 1) {
  const result = spawnSync(
    "xelatex",
    ["-interaction=nonstopmode", "-halt-on-error", source],
    {
      cwd: workdir,
      encoding: "utf8",
    },
  );
  if (result.error) {
    console.error(
      "无法运行 xelatex，请先安装 TeX Live 或 TinyTeX：",
      result.error.message,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    const errors = result.stdout.split("\n").filter((line) => line.startsWith("!"));
    console.error(
      `xelatex 第 ${pass} 遍失败：\n${errors.join("\n") || result.stdout.slice(-2000)}`,
    );
    console.error("完整日志：docs/latex/technical-doc.log");
    process.exit(1);
  }
}

const output = join(workdir, "technical-doc.pdf");
if (!existsSync(output)) {
  console.error("未生成 PDF");
  process.exit(1);
}
copyFileSync(output, join(root, "docs", "技术文档.pdf"));
console.log("已生成 docs/技术文档.pdf");
