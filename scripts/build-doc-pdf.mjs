/**
 * 生成技术文档 PDF：Pandoc 把 Markdown 转成 HTML，再用 Chromium 打印为 A4 PDF。
 * 字体使用项目自带的 Noto Serif / Sans SC，图片引用 docs/images。
 * 运行：npm run docs:pdf（需要本机安装 pandoc 与 Playwright Chromium）
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const source = resolve(root, "docs/技术文档.md");
const html = resolve(root, "docs/.技术文档.build.html");
const output = resolve(root, "docs/技术文档.pdf");
const fonts = ["noto-sans-sc", "noto-serif-sc"].map(
  (name) =>
    pathToFileURL(resolve(root, `node_modules/@fontsource-variable/${name}/index.css`))
      .href,
);
const css = pathToFileURL(resolve(root, "scripts/doc-assets/doc.css")).href;

execFileSync("pandoc", [
  source,
  "--from=markdown+raw_html",
  "--to=html5",
  "--standalone",
  `--template=${resolve(root, "scripts/doc-assets/template.html")}`,
  "--toc",
  "--toc-depth=2",
  "--metadata=lang:zh-CN",
  ...fonts.map((href) => `--css=${href}`),
  `--css=${css}`,
  `--output=${html}`,
]);

// 与 scripts/playwright.mjs 一致：使用安装在 node_modules 内的浏览器
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: output,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="width:100%;font-size:8px;color:#8d8274;text-align:center;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: "18mm", bottom: "18mm", left: "17mm", right: "17mm" },
});
await browser.close();
rmSync(html);
const pages = (readFileSync(output, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`生成 ${output}，共 ${pages} 页`);
