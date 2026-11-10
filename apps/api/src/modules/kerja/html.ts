/**
 * KERJA-001 §6.4 and KERJA-IMPL-001 §10 nomor 2: the shared composer stores HTML, so every
 * description and comment passes through this allowlist when stored **and** when shown.
 *
 * Everything outside the allowlist is dropped, never escaped into view: `<script>`, `<style>` and
 * their content, `on*` attributes, `style`, `class`, `javascript:` links, Word's conditional
 * comments and `<o:p>` tags. Text is decoded and re-escaped, so a stray `<` cannot open a tag.
 */

// Every pattern below stops at the next "<" (or consumes to the end), so a run of unclosed
// "<" costs linear time instead of one rescan per "<" (independent review of PR #200).
const BLOCK_OPENER = /<(script|style|iframe|object|embed|template|noscript|xml|head|title|svg|math|textarea|select)\b/gi;
const COMMENTS = /<!--[\s\S]*?(?:-->|$)|<![^<>]*>|<\?[^<>]*>/g;
const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)\b((?:[^<>"']|"[^<"]*"|'[^<']*')*)>|([^<]+)|(<)/g;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const RENAME: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s" };
const ALLOWED = new Set(["p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote", "code", "pre", "a", "span"]);
const BLOCK = new Set(["p", "br", "li", "blockquote", "pre", "ul", "ol", "div", "h1", "h2", "h3", "h4", "h5", "h6", "tr"]);
const PERSON_ID = /^hcis:employee:[0-9a-f-]{36}$/;

export interface SanitizedHtml {
  html: string;
  /** Plain text for search and notifications; never rendered as HTML. */
  text: string;
  /** Person ids mentioned with `<span data-sebut>` that passed `canMention`. */
  mentions: string[];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    if (found.has(name)) continue;
    found.set(name, decodeEntities(match[3] ?? match[4] ?? match[5] ?? ""));
  }
  return found;
}

/** Only absolute http(s) and mailto links; control characters and spaces cannot hide a scheme. */
export function safeHref(raw: string): string | null {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
  const compact = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!/^(https?:\/\/|mailto:)/i.test(compact)) return null;
  if (compact.length > 2000) return null;
  return compact;
}

/** Drops script-like blocks with their content; an unclosed one drops everything after it. */
function dropBlocks(input: string): string {
  const opener = new RegExp(BLOCK_OPENER.source, "gi");
  let out = "";
  let last = 0;
  for (let match = opener.exec(input); match; match = opener.exec(input)) {
    out += input.slice(last, match.index);
    const close = new RegExp(`</${match[1]!.toLowerCase()}\\s*>`, "gi");
    close.lastIndex = opener.lastIndex;
    const end = close.exec(input);
    if (!end) return out;
    last = end.index + end[0].length;
    opener.lastIndex = last;
  }
  return out + input.slice(last);
}

export function sanitizeHtml(input: string, canMention: (personId: string) => boolean = () => false): SanitizedHtml {
  const cleaned = dropBlocks(input.replace(COMMENTS, ""));
  const out: string[] = [];
  const text: string[] = [];
  const mentions = new Set<string>();
  // Each open allowed tag, or null for an opened tag that was dropped (so its closing tag is too).
  const stack: Array<string | null> = [];

  for (const match of cleaned.matchAll(TOKEN)) {
    const [, closing, rawName, rawAttributes, textPart, loneBracket] = match;
    if (textPart !== undefined) {
      const decoded = decodeEntities(textPart);
      out.push(escapeHtml(decoded));
      text.push(decoded);
      continue;
    }
    if (loneBracket !== undefined) {
      out.push("&lt;");
      text.push("<");
      continue;
    }
    const lower = rawName!.toLowerCase();
    const name = RENAME[lower] ?? lower;
    if (BLOCK.has(lower)) text.push("\n");

    if (closing) {
      const index = stack.lastIndexOf(name);
      if (index < 0) continue;
      while (stack.length > index) {
        const open = stack.pop();
        if (open) out.push(`</${open}>`);
      }
      continue;
    }

    if (!ALLOWED.has(name)) continue;
    if (name === "br") {
      out.push("<br>");
      continue;
    }
    const attrs = attributes(rawAttributes ?? "");
    if (name === "a") {
      const href = safeHref(attrs.get("href") ?? "");
      if (!href) {
        stack.push(null);
        continue;
      }
      out.push(`<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">`);
      stack.push("a");
      continue;
    }
    if (name === "span") {
      const personId = attrs.get("data-sebut") ?? "";
      if (!PERSON_ID.test(personId) || !canMention(personId)) {
        stack.push(null);
        continue;
      }
      mentions.add(personId);
      out.push(`<span data-sebut="${escapeHtml(personId)}">`);
      stack.push("span");
      continue;
    }
    out.push(`<${name}>`);
    stack.push(name);
  }
  while (stack.length > 0) {
    const open = stack.pop();
    if (open) out.push(`</${open}>`);
  }

  const plain = text.join("").replace(/[^\S\n]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
  return { html: out.join(""), text: plain, mentions: [...mentions] };
}

/** Display path: mentions were checked when stored; any well-formed person id is kept. */
export function sanitizeForDisplay(html: string): string {
  return sanitizeHtml(html, () => true).html;
}
