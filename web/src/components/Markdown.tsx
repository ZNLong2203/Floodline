// A small, safe Markdown renderer for assistant answers: paragraphs, headings,
// bullet and numbered lists (one level of nesting), **bold**, *italic*, `code`
// and https links. It builds React elements; no HTML from the model is injected.
import type { ReactNode } from "react";

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
      out.push(
        lm ? (
          <a key={k} href={lm[2]} target="_blank" rel="noreferrer">
            {lm[1]}
          </a>
        ) : (
          tok
        ),
      );
    } else out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Item = { text: string; indent: number };
type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; items: Item[] }
  | { kind: "hr" };

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: Item[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    if (list) blocks.push(list);
    para = [];
    list = null;
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    let m: RegExpExecArray | null;
    if ((m = /^#{1,6}\s+(.*)$/.exec(t))) {
      flush();
      blocks.push({ kind: "h", text: m[1] });
    } else if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      blocks.push({ kind: "hr" });
    } else if ((m = /^[*\-•]\s+(.*)$/.exec(t)) || (m = /^\d+[.)]\s+(.*)$/.exec(t))) {
      const kind = /^\d/.test(t) ? "ol" : "ul";
      if (para.length) {
        blocks.push({ kind: "p", lines: para });
        para = [];
      }
      if (!list || (list.kind !== kind && indent === 0)) {
        if (list) blocks.push(list);
        list = { kind, items: [] };
      }
      list.items.push({ text: m[1], indent: indent >= 2 ? 1 : 0 });
    } else if (list && indent >= 2) {
      // continuation of a list item
      const last = list.items[list.items.length - 1];
      last.text += ` ${t}`;
    } else {
      if (list) {
        blocks.push(list);
        list = null;
      }
      para.push(t);
    }
  }
  flush();
  return blocks;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parse(text ?? "");
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === "h") return <h4 key={i}>{inline(b.text, `h${i}`)}</h4>;
        if (b.kind === "hr") return <hr key={i} />;
        if (b.kind === "p")
          return (
            <p key={i}>
              {b.lines.flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l, `p${i}-${j}`)] : inline(l, `p${i}-${j}`)))}
            </p>
          );
        const Tag = b.kind;
        return (
          <Tag key={i}>
            {b.items.map((it, j) => (
              <li key={j} className={it.indent ? "md__sub" : undefined}>
                {inline(it.text, `l${i}-${j}`)}
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
