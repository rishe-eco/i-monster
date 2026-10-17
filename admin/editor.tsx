// The editor (plan B6, PD-7): the body of an entry, with the toolbar and the link field.
//
// It is one component behind a small face (`value`, `onChange`, `lang`, `readOnly`), so that PD-7's
// fallback, a textarea read by `docFromText`, could take its place without touching a screen that
// uses it. ProseMirror is used for what the plan needs and nothing more: the schema of
// `shared/doc.ts`, history, the base keymap, two marks, and the bidi decorations. There are no
// input rules, no menu and no placeholder plugin.
//
// Everything about the document lives in `editor-model.ts`; this file is the part that touches the DOM.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import { DecorationSet, EditorView } from 'prosemirror-view';
import { dirOf, type Lang } from '../lib/i18n.ts';
import { stripXmlForbidden, type Doc } from '../shared/doc.ts';
import { copy } from './copy.ts';
import { bidiDecorations, cleanHref, cleanSlice, fromPm, highlightOn, isBlank, linkAt, schema, toPm } from './editor-model.ts';

export interface EditorProps {
  /** The body. When it changes to something the editor did not itself just report, the editor shows it (a restored text, an emptied one). */
  value: Doc;
  /** Called with the stored form of the body, empty paragraphs already dropped (S-4), on every change the person makes. */
  onChange: (doc: Doc) => void;
  /** The entry's language. It sets the body's `lang` and `dir` (AC-42) and what the bidi decorations isolate (PD-8). */
  lang: Lang;
  /** True while a request is in flight: the text can be read and not changed. */
  readOnly: boolean;
  /** An id in the page that names the body, for assistive technology. */
  labelId: string;
  /** Shown while the body is empty. Drawn by a class and CSS, not by a plugin. */
  placeholder: string;
  /** Sits at the end of the toolbar's row: "Kept on this phone". */
  toolbarEnd?: ComponentChildren;
  /** What belongs under the toolbar and must stay with it in view: the notices and the actions. */
  dock?: ComponentChildren;
}

/** The address field, in place under the body (plate 8, F5). `existing` is a link already in the text; otherwise it is a new one on the selected words. */
interface LinkField {
  from: number;
  to: number;
  existing: boolean;
}

/**
 * Make ProseMirror's selection the one the DOM has right now. The browser reports a selection to the page a moment
 * after it changes, and a toolbar button tapped in that moment would act on the words as they were before the last
 * key or touch handle moved. Nothing is changed when the two already agree, or when the selection is not in the text.
 */
function catchUpWithSelection(view: EditorView): void {
  const dom = window.getSelection();
  if (!dom?.anchorNode || !dom.focusNode || !view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return;
  try {
    const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
    const head = view.posAtDOM(dom.focusNode, dom.focusOffset);
    const { selection } = view.state;
    if (selection.anchor !== anchor || selection.head !== head) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
  } catch {
    // The DOM is in the middle of a change: the state stays as it is.
  }
}

export function Editor({ value, onChange, lang, readOnly, labelId, placeholder, toolbarEnd, dock }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dockEl = useRef<HTMLDivElement>(null);
  // What the editor's handlers need to read, without re-creating the view when it changes.
  const latest = useRef({ value, onChange, lang, readOnly, labelId, placeholder });
  latest.current = { value, onChange, lang, readOnly, labelId, placeholder };
  // Every body the editor has reported. The parent keeps what it is given and hands it back as `value`, a render or
  // two later, by which time the person may have typed more: that echo is the editor's own and must never be applied,
  // or it would put the older text back over the newer. Only a body the editor did not report is a change from outside.
  const reported = useRef(new WeakSet<Doc>());
  // The words a new link will wrap, kept while the address is typed, and the link whose field was closed with Done.
  const pending = useRef<{ from: number; to: number } | null>(null);
  const dismissed = useRef<{ from: number; to: number } | null>(null);

  const [blank, setBlank] = useState(() => isBlank(toPm(value)));
  const [highlighted, setHighlighted] = useState(false);
  const [field, setField] = useState<LinkField | null>(null);
  // The same field, readable inside the view's handlers without waiting for a render.
  const fieldNow = useRef<LinkField | null>(null);
  const [address, setAddress] = useState('');
  const [refused, setRefused] = useState(false);
  const [hint, setHint] = useState(false);
  const [focusField, setFocusField] = useState(false);

  const showField = (next: LinkField | null, href = '') => {
    fieldNow.current = next;
    setField(next);
    setAddress(href);
    setRefused(false);
  };

  /** Read what the toolbar and the link field show from the editor's state. Called after every transaction. */
  const sync = (state: EditorState) => {
    setBlank(isBlank(state.doc));
    setHighlighted(highlightOn(state));
    const open = pending.current;
    // The words a new link is being made on are still selected: the field stays as it is.
    if (open && state.selection.from === open.from && state.selection.to === open.to) return;
    pending.current = null;
    const found = linkAt(state);
    if (!found) {
      dismissed.current = null;
      if (fieldNow.current) showField(null);
      return;
    }
    const gone = dismissed.current;
    if (gone && gone.from === found.from && gone.to === found.to) return;
    const current = fieldNow.current;
    // The caret moved within a link whose field is already open: leave what is being typed alone.
    if (current?.existing && current.from === found.from && current.to === found.to) return;
    showField({ from: found.from, to: found.to, existing: true }, found.href);
  };

  useEffect(() => {
    if (!host.current) return undefined;
    const state = EditorState.create({
      doc: toPm(latest.current.value),
      plugins: [
        history(),
        keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
        keymap(baseKeymap),
      ],
    });
    const created: EditorView = new EditorView(host.current, {
      state,
      attributes: () => ({
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': latest.current.labelId,
        'aria-placeholder': latest.current.placeholder,
        lang: latest.current.lang,
        dir: dirOf(latest.current.lang),
      }),
      editable: () => !latest.current.readOnly,
      // While a keyboard is composing a word (Android's autocorrect, Persian input methods), the DOM
      // is the keyboard's: wrapping runs in <bdi> under it would break the composition. The runs are
      // drawn again when it ends, below.
      // `view.current` is still empty while the view is being made, which is the same as not composing.
      decorations: (current) => (view.current?.composing ? DecorationSet.empty : bidiDecorations(current.doc, latest.current.lang)),
      transformPastedText: (text) => stripXmlForbidden(text),
      transformPastedHTML: (html) => stripXmlForbidden(html),
      transformPasted: cleanSlice,
      handleDOMEvents: {
        compositionend: () => {
          // After ProseMirror has read the composition, draw the isolated runs it left out.
          window.setTimeout(() => view.current?.dispatch(view.current.state.tr.setMeta('bidi', true)), 60);
          return false;
        },
      },
      dispatchTransaction(transaction) {
        const live = view.current;
        if (!live) return;
        const next = live.state.apply(transaction);
        live.updateState(next);
        if (transaction.docChanged) {
          const doc = fromPm(next.doc);
          reported.current.add(doc);
          setHint(false);
          latest.current.onChange(doc);
        }
        sync(next);
      },
    });
    view.current = created;
    sync(created.state);
    return () => {
      created.destroy();
      view.current = null;
    };
    // The view is made once; the handlers above read the latest props through `latest`.
  }, []);

  // The language and the read-only flag change the editable element's attributes and the isolated runs.
  useEffect(() => {
    view.current?.setProps({});
  }, [lang, readOnly, placeholder]);

  // The dock covers the foot of the screen, so the line being typed must scroll into view above it, not under it.
  useEffect(() => {
    const dockNow = dockEl.current;
    if (!dockNow || typeof ResizeObserver === 'undefined') return undefined;
    // The threshold makes it scroll as soon as the line reaches the dock, and the margin leaves a little air above it.
    const apply = () => {
      const below = dockNow.offsetHeight + 12;
      view.current?.setProps({ scrollThreshold: { top: 8, left: 8, right: 8, bottom: below }, scrollMargin: { top: 8, left: 8, right: 8, bottom: below } });
    };
    const observer = new ResizeObserver(apply);
    observer.observe(dockNow);
    apply();
    return () => observer.disconnect();
  }, []);

  // A body the editor did not report: a text put back, or an empty one after publishing. A fresh state, so undo can't reach back into it.
  useEffect(() => {
    const current = view.current;
    if (!current || reported.current.has(value)) return;
    // The same words as it holds already (a parent that built an equal body of its own): nothing to change.
    if (JSON.stringify(fromPm(current.state.doc)) === JSON.stringify(value)) return;
    const doc = toPm(value);
    pending.current = null;
    dismissed.current = null;
    if (fieldNow.current) showField(null);
    current.updateState(EditorState.create({ doc, plugins: current.state.plugins, selection: Selection.atEnd(doc) }));
    sync(current.state);
  }, [value]);

  // Opening the field by a tap on Link puts the cursor in it; opening it by the caret in a link doesn't take it from the text.
  useEffect(() => {
    if (field && focusField) input.current?.focus();
    if (focusField) setFocusField(false);
  }, [field, focusField]);

  const closeField = (keepDismissed: boolean) => {
    if (keepDismissed && fieldNow.current) dismissed.current = { from: fieldNow.current.from, to: fieldNow.current.to };
    pending.current = null;
    showField(null);
    view.current?.focus();
  };

  const openLink = () => {
    const current = view.current;
    if (!current) return;
    catchUpWithSelection(current);
    const { from, to, empty } = current.state.selection;
    const found = linkAt(current.state);
    if (found) {
      dismissed.current = null;
      pending.current = null;
      showField({ from: found.from, to: found.to, existing: true }, found.href);
      setFocusField(true);
      return;
    }
    // A link wraps words; with nothing selected there is nothing to wrap.
    if (empty) return setHint(true);
    setHint(false);
    pending.current = { from, to };
    showField({ from, to, existing: false });
    setFocusField(true);
  };

  const applyLink = () => {
    const current = view.current;
    if (!current || !field) return;
    const text = address.trim();
    // Nothing typed: nothing to do, whether the link is new or old. Remove link is the way to take one away.
    if (text === '') return closeField(true);
    const href = cleanHref(text);
    if (href === null) return setRefused(true);
    const mark = schema.marks.link;
    if (!mark) return;
    current.dispatch(current.state.tr.removeMark(field.from, field.to, mark).addMark(field.from, field.to, mark.create({ href })));
    closeField(true);
  };

  const removeLink = () => {
    const current = view.current;
    const mark = schema.marks.link;
    if (!current || !field || !mark) return;
    current.dispatch(current.state.tr.removeMark(field.from, field.to, mark));
    closeField(false);
  };

  const highlight = () => {
    const current = view.current;
    const mark = schema.marks.highlight;
    if (!current || !mark) return;
    catchUpWithSelection(current);
    toggleMark(mark)(current.state, current.dispatch);
    current.focus();
  };

  // A toolbar button must not take the focus from the text: on a phone that is the keyboard going away.
  const keepFocus = (event: Event) => event.preventDefault();

  const fieldId = `${labelId}-link`;
  const fieldProblem = `${labelId}-link-problem`;
  const t = copy.editor;

  return (
    <div class="editor">
      <span class="visually-hidden" id={labelId}>
        {t.bodyLabel}
      </span>
      <div class={blank ? 'editor__body editor__body--blank' : 'editor__body'} data-placeholder={placeholder} lang={lang} dir={dirOf(lang)} ref={host} />

      {field ? (
        <div class="linkfield">
          <label class="field__label" for={fieldId}>
            {t.linkAddress}
          </label>
          <input
            class="field__input field__input--code"
            id={fieldId}
            ref={input}
            type="text"
            inputMode="url"
            dir="ltr"
            autocapitalize="off"
            autocomplete="off"
            spellcheck={false}
            value={address}
            disabled={readOnly}
            aria-invalid={refused}
            aria-describedby={refused ? fieldProblem : undefined}
            onInput={(event) => {
              setAddress((event.currentTarget as HTMLInputElement).value);
              setRefused(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                closeField(true);
              }
            }}
          />
          {refused ? (
            <p class="notice notice--error" id={fieldProblem} role="alert">
              {t.linkRefused}
            </p>
          ) : null}
          <div class="linkfield__actions">
            {field.existing ? (
              <button type="button" class="btn" disabled={readOnly} onClick={removeLink}>
                {t.removeLink}
              </button>
            ) : null}
            <button type="button" class="btn" disabled={readOnly} onClick={applyLink}>
              {t.done}
            </button>
          </div>
        </div>
      ) : null}

      {hint ? (
        <p class="hint" role="status">
          {t.linkNeedsSelection}
        </p>
      ) : null}

      {/* The dock stays at the foot of the screen while the text above it scrolls, so with the keyboard up the tools and the actions are still in reach. */}
      <div class="dock" ref={dockEl}>
        <div class="toolbar">
          <div class="toolbar__tools" role="group" aria-label={t.toolbar}>
            <button type="button" class="btn tool" aria-expanded={field !== null} aria-controls={field ? fieldId : undefined} disabled={readOnly} onMouseDown={keepFocus} onClick={openLink}>
              {t.link}
            </button>
            <button type="button" class="btn tool tool--highlight" aria-pressed={highlighted} disabled={readOnly} onMouseDown={keepFocus} onClick={highlight}>
              {t.highlight}
            </button>
          </div>
          {toolbarEnd}
        </div>
        {dock}
      </div>
    </div>
  );
}
