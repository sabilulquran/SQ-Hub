import { Bold, Italic, List, ListOrdered } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

import type { Orang } from "@/kerja/api";

/**
 * KERJA-001 §6.4: one composer for descriptions and comments, with `@sebut` limited to the room's
 * members. Pasting inserts plain text only; the server cleans whatever HTML still arrives
 * (KERJA-IMPL-001 §10 nomor 2), so nothing pasted can carry attributes into the editor.
 */
export function Composer({
  initialHtml = "",
  members,
  placeholder,
  label,
  autoFocus = false,
  onChange,
}: {
  initialHtml?: string;
  members: Orang[];
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  onChange: (html: string, text: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null);
  const [empty, setEmpty] = useState(initialHtml.trim().length === 0);

  useEffect(() => {
    if (!editorRef.current) return;
    // The initial HTML was cleaned by the server before it reached the browser.
    editorRef.current.innerHTML = initialHtml;
    if (autoFocus) editorRef.current.focus();
    // Only on mount: later edits live in the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = editor.innerText.trim();
    setEmpty(text.length === 0);
    onChange(editor.innerHTML, text);
  };

  const detectMention = () => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!selection || !node || node.nodeType !== Node.TEXT_NODE) return setMention(null);
    const before = (node.textContent ?? "").slice(0, selection.anchorOffset);
    const match = /(^|\s)@([\p{L}\s]{0,30})$/u.exec(before);
    setMention(match ? { query: match[2]!.trimStart(), index: 0 } : null);
  };

  const candidates = mention
    ? members.filter((member) => member.aktif && member.nama.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase())).slice(0, 6)
    : [];

  const insertMention = (member: Orang) => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!selection || !node || node.nodeType !== Node.TEXT_NODE || !mention) return;
    const text = node.textContent ?? "";
    const caret = selection.anchorOffset;
    const start = text.lastIndexOf("@", caret);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, caret);
    range.deleteContents();
    const span = document.createElement("span");
    span.dataset.sebut = member.id;
    span.contentEditable = "false";
    span.className = "kerja-sebut";
    span.textContent = `@${member.nama}`;
    range.insertNode(span);
    const space = document.createTextNode(" ");
    span.after(space);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    setMention(null);
    emit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!mention || candidates.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setMention({ ...mention, index: (mention.index + step + candidates.length) % candidates.length });
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertMention(candidates[mention.index]!);
    } else if (event.key === "Escape") {
      setMention(null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  const command = (name: string) => {
    editorRef.current?.focus();
    document.execCommand(name);
    emit();
  };

  const tools: Array<{ name: string; label: string; icon: typeof Bold }> = [
    { name: "bold", label: "Tebal", icon: Bold },
    { name: "italic", label: "Miring", icon: Italic },
    { name: "insertUnorderedList", label: "Daftar berbutir", icon: List },
    { name: "insertOrderedList", label: "Daftar bernomor", icon: ListOrdered },
  ];

  return (
    <div className="relative rounded-xl border border-border bg-surface-raised focus-within:border-brand-primary">
      <div className="flex gap-1 border-b border-border px-1.5 py-1" role="toolbar" aria-label={`Format ${label}`}>
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button key={tool.name} type="button" aria-label={tool.label} title={tool.label} onMouseDown={(event) => event.preventDefault()} onClick={() => command(tool.name)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="relative">
        {empty ? <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">{placeholder}</span> : null}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable
          suppressContentEditableWarning
          className="kerja-prose min-h-20 px-3 py-2.5 text-sm leading-6 outline-none"
          onInput={() => {
            emit();
            detectMention();
          }}
          onKeyUp={(event) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) detectMention();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => window.setTimeout(() => setMention(null), 150)}
        />
      </div>
      {mention && candidates.length > 0 ? (
        <ul role="listbox" aria-label="Sebut anggota ruang" className="absolute left-2 right-2 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface-raised p-1 shadow-[var(--shadow-raised)] sm:right-auto sm:w-72">
          {candidates.map((member, index) => (
            <li key={member.id} role="option" aria-selected={index === mention.index}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(member)} className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${index === mention.index ? "bg-brand-primary-pale text-brand-primary-deep" : "hover:bg-muted"}`}>
                {member.nama}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Server-cleaned HTML (KERJA-IMPL-001 §10 nomor 2) shown read-only. */
export function RichText({ html, empty }: { html: string; empty?: string }) {
  if (!html.trim()) return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null;
  return <div className="kerja-prose text-sm leading-6" dangerouslySetInnerHTML={{ __html: html }} />;
}
