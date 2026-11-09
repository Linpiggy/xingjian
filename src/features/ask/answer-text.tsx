/**
 * 把模型回答渲染成段落与列表。只做纯文本处理（React 自动转义），
 * 去掉 Markdown 标记与链接，不渲染任何 HTML。
 */
import { Fragment } from "react";

function clean(line: string): string {
  return line
    .replace(/\*\*|__|`/g, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
}

export function AnswerText({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const blocks: { type: "p" | "ul"; lines: string[] }[] = [];
  for (const raw of text.split(/\n+/)) {
    const bullet = /^\s*(?:[-*•·]|\d+[.、)])\s+/.test(raw);
    const line = clean(raw.replace(/^\s*(?:[-*•·]|\d+[.、)])\s+/, ""));
    if (!line) {
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.type === "ul") {
        last.lines.push(line);
      } else {
        blocks.push({ type: "ul", lines: [line] });
      }
    } else {
      blocks.push({ type: "p", lines: [line] });
    }
  }
  const caret = streaming ? (
    <span
      className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse-dot bg-pine align-middle"
      aria-hidden
    />
  ) : null;
  if (!blocks.length) {
    return caret;
  }
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-ink">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        return block.type === "ul" ? (
          <ul key={index} className="space-y-1">
            {block.lines.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className="mt-2.5 size-1.5 shrink-0 rounded-full bg-pine"
                  aria-hidden
                />
                <span>
                  {line}
                  {isLast && i === block.lines.length - 1 ? caret : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((line, i) => (
              <Fragment key={i}>{line}</Fragment>
            ))}
            {isLast ? caret : null}
          </p>
        );
      })}
    </div>
  );
}
