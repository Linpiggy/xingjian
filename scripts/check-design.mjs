import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const failures = [];
function fail(file, message) {
  failures.push(`${file}: ${message}`);
}
const files = fs
  .readdirSync("src", { recursive: true })
  .filter((file) => /\.(css|tsx)$/u.test(file))
  .map((file) => path.join("src", file));
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const primitive = file.split(path.sep).includes("arc");
  if (file.endsWith(".tsx")) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (
          !primitive &&
          ["button", "input", "select", "textarea", "dialog"].includes(tag)
        ) {
          fail(file, `native <${tag}> outside Arc`);
        }
        const className = node.attributes.properties.find(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === "className",
        );
        if (className) {
          function inspect(value) {
            if (
              (ts.isStringLiteral(value) ||
                ts.isNoSubstitutionTemplateLiteral(value) ||
                ts.isTemplateHead(value) ||
                ts.isTemplateMiddle(value) ||
                ts.isTemplateTail(value)) &&
              /(?:^|\s)button(?:\s|$)/u.test(value.text)
            ) {
              fail(file, "legacy button class");
            }
            ts.forEachChild(value, inspect);
          }
          inspect(className);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    continue;
  }
  const rootStart =
    file === path.join("src", "app", "globals.css") ? text.indexOf(":root {") : -1;
  const rootEnd = rootStart < 0 ? -1 : text.indexOf("}", rootStart);
  const declaration = /(?:^|[;{}\n])\s*(--[\w-]+|[\w-]+)\s*:\s*([^;{}]+);/gu;
  for (const match of text.matchAll(declaration)) {
    if (match.index >= rootStart && match.index < rootEnd) {
      continue;
    }
    const [, property, value] = match;
    if (property.startsWith("--") && !/^var\(--[\w-]+\)$/u.test(value.trim())) {
      fail(file, `non-alias ${property}`);
    }
    if (/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(|\b(?:white|black)\b/iu.test(value)) {
      fail(file, `literal color in ${property}`);
    }
    if (
      (property === "font-size" || property === "font") &&
      /\d(?:px|rem|em|vw|vh|%)/u.test(value)
    ) {
      fail(file, `literal type scale in ${property}`);
    }
    if (/radius$/u.test(property) && /\d(?:px|rem|em)/u.test(value)) {
      fail(file, "literal radius");
    }
    if (
      property === "box-shadow" &&
      !/^(?:none|inherit|var\(--[\w-]+\))$/u.test(value.trim())
    ) {
      fail(file, "literal shadow");
    }
    if (
      /^(?:(?:scroll-)?(?:margin|padding)(?:-[\w-]+)?|(?:row-|column-)?gap)$/u.test(
        property,
      ) &&
      /\d(?:px|rem|em)/u.test(value)
    ) {
      fail(file, `literal spacing in ${property}`);
    }
  }
}
const buttonCss = fs.readFileSync("src/components/arc/button/button.module.css", "utf8");
for (const declaration of [
  "min-height: var(--control-height-md)",
  "font-size: var(--text-sm)",
  "border-radius: var(--radius-control)",
]) {
  if (!buttonCss.includes(declaration)) {
    fail("Arc Button", `missing shared ${declaration}`);
  }
}
if (failures.length) {
  console.error(failures.slice(0, 30).join("\n"));
  console.error(`FAIL design guard: ${failures.length} violations`);
  process.exitCode = 1;
} else {
  console.log("PASS design guard: root-only scales and Arc-only controls");
}
