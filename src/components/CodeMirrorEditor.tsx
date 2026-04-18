import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const lensHighlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--color-fg)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--color-accent)" },
  { tag: t.url, color: "var(--color-accent)" },
  { tag: t.monospace, color: "var(--color-fg-muted)" },
  { tag: t.meta, color: "var(--color-fg-dim)" },
  { tag: t.quote, color: "var(--color-fg-muted)", fontStyle: "italic" },
]);

const lensTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-mono)",
    fontSize: "14px",
    backgroundColor: "var(--color-card)",
    color: "var(--color-fg)",
    height: "100%",
  },
  ".cm-content": {
    padding: "1rem 0",
    caretColor: "var(--color-accent)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--color-fg-dim)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-fg-muted)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--color-accent-light) !important",
    opacity: 0.3,
  },
});

export interface CodeMirrorEditorHandle {
  insertAtCursor(text: string): void;
  focus(): void;
}

interface Props {
  value: string;
  onChange(next: string): void;
  onSave?(): void;
  onCancel?(): void;
  onPasteFile?(files: File[]): boolean;
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, Props>(function CodeMirrorEditor(
  { value, onChange, onSave, onCancel, onPasteFile },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);
  const onPasteFileRef = useRef(onPasteFile);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCancelRef.current = onCancel;
  onPasteFileRef.current = onPasteFile;

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(text: string) {
        const v = view.current;
        if (!v) return;
        const pos = v.state.selection.main.head;
        v.dispatch({
          changes: { from: pos, insert: text },
          selection: { anchor: pos + text.length },
        });
        v.focus();
      },
      focus() {
        view.current?.focus();
      },
    }),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: editor builds once; handlers are re-read via refs
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        lineNumbers(),
        markdown(),
        syntaxHighlighting(lensHighlight),
        lensTheme,
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          paste(event) {
            const items = event.clipboardData?.items;
            if (!items) return false;
            const files: File[] = [];
            for (const item of items) {
              if (item.kind === "file") {
                const f = item.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length === 0) return false;
            const handled = onPasteFileRef.current?.(files);
            if (handled) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          {
            key: "Escape",
            run: () => {
              onCancelRef.current?.();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-full overflow-auto" />;
});
