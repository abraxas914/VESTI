import type { AstNode, AstRoot, AstTableNode } from "../types";

// Faithful AST → HTML serializer for "Copy as rich text" / Send-to. Produces a
// self-contained HTML fragment so a pasted conversation keeps its headings,
// lists, code, tables, and emphasis (the things plain-text copy loses). Mirrors
// RichMessageContent's node handling but emits an HTML string.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nodesToHtml(nodes: AstNode[]): string {
  return nodes.map(nodeToHtml).join("");
}

function alignStyle(align: "left" | "center" | "right" | null | undefined): string {
  return align ? ` style="text-align:${align}"` : "";
}

function tableToHtml(node: AstTableNode): string {
  if (node.kind === "v2") {
    const cols = node.columns.length > 0 ? node.columns : [{ header: [], align: null }];
    const head = cols
      .map((c) => `<th${alignStyle(c.align)}>${nodesToHtml(c.header)}</th>`)
      .join("");
    const body = node.rows
      .map(
        (row) =>
          `<tr>${row.cells
            .map(
              (cell, i) =>
                `<td${alignStyle(cell.align ?? cols[i]?.align ?? null)}>${nodesToHtml(
                  cell.children,
                )}</td>`,
            )
            .join("")}</tr>`,
      )
      .join("");
    return `<table border="1" cellspacing="0" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  const head = (node.headers ?? []).map((h) => `<th>${esc(h)}</th>`).join("");
  const body = (node.rows ?? [])
    .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table border="1" cellspacing="0" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function nodeToHtml(node: AstNode): string {
  switch (node.type) {
    case "text":
      return esc(node.text);
    case "fragment":
      return nodesToHtml(node.children);
    case "p":
      return `<p>${nodesToHtml(node.children)}</p>`;
    case "h1":
      return `<h1>${nodesToHtml(node.children)}</h1>`;
    case "h2":
      return `<h2>${nodesToHtml(node.children)}</h2>`;
    case "h3":
      return `<h3>${nodesToHtml(node.children)}</h3>`;
    case "br":
      return "<br>";
    case "strong":
      return `<strong>${nodesToHtml(node.children)}</strong>`;
    case "em":
      return `<em>${nodesToHtml(node.children)}</em>`;
    case "code_inline":
      return `<code>${esc(node.text)}</code>`;
    case "code_block":
      return `<pre><code>${esc(node.code)}</code></pre>`;
    case "ul":
      return `<ul>${nodesToHtml(node.children)}</ul>`;
    case "ol":
      return `<ol>${nodesToHtml(node.children)}</ol>`;
    case "li":
      return `<li>${nodesToHtml(node.children)}</li>`;
    case "blockquote":
      return `<blockquote>${nodesToHtml(node.children)}</blockquote>`;
    case "table":
      return tableToHtml(node);
    case "math":
      // Keep the raw TeX (with delimiters) so it survives the paste recognizably.
      return node.display
        ? `<p style="text-align:center"><code>$$${esc(node.tex)}$$</code></p>`
        : `<code>$${esc(node.tex)}$</code>`;
    case "attachment":
      return `<em>[${esc(node.name)}]</em>`;
    default:
      return "";
  }
}

/** Serialize an AST root to an HTML fragment string. */
export function astToHtml(root: AstRoot | null | undefined): string {
  if (!root || root.type !== "root" || !Array.isArray(root.children)) return "";
  return nodesToHtml(root.children);
}

/** Escape a plain string into a minimal HTML paragraph block (fallback). */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
