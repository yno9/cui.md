import { st } from './state';
import { CM5_KEY } from './config';

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function autoResizeTextarea(_ta: HTMLTextAreaElement) {}

export function makeTextareaEditor(ta: HTMLTextAreaElement) {
  let _changeHandler: Function | null = null;
  const _focusHandlers: Function[] = [];
  const _blurHandlers: Function[] = [];
  ta.addEventListener('focus', () => _focusHandlers.forEach(fn => fn()));
  ta.addEventListener('blur', () => _blurHandlers.forEach(fn => fn()));
  ta.addEventListener('input', () => {
    autoResizeTextarea(ta);
    if (_changeHandler) _changeHandler({}, { origin: 'input' });
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      e.preventDefault();
      e.stopPropagation();
      ta.blur();
      const fileListEl = document.getElementById('fileList')!;
      fileListEl.classList.remove('editor-focused');
      fileListEl.classList.add('keyboard-nav');
      const active = fileListEl.querySelector<HTMLElement>('li.active');
      if (active) {
        active.classList.add('nav-focus');
        active.scrollIntoView({ block: 'nearest' });
      }
    }
  });
  const wrapStyle = {
    set display(v: string) { ta.style.display = v === '' ? 'block' : v; },
    get display() { return ta.style.display; },
  };
  return {
    getValue: () => ta.value,
    setValue: (v: string) => { ta.value = v; ta.setSelectionRange(0, 0); requestAnimationFrame(() => autoResizeTextarea(ta)); },
    getWrapperElement: () => ({ style: wrapStyle, addEventListener: ta.addEventListener.bind(ta) }),
    focus: () => ta.focus(),
    hasFocus: () => document.activeElement === ta,
    refresh: () => { autoResizeTextarea(ta); },
    getCursor: () => null,
    getScrollInfo: () => ({ left: 0, top: ta.scrollTop }),
    setCursor: () => {},
    scrollTo: (_x: number, y: number) => { if (y != null) ta.scrollTop = y; },
    setOption: () => {},
    on: (event: string, fn: Function) => {
      if (event === 'change') _changeHandler = fn;
      if (event === 'focus') _focusHandlers.push(fn);
      if (event === 'blur') _blurHandlers.push(fn);
    },
  };
}

export function initEditor() {
  const useCM5 = localStorage.getItem(CM5_KEY) === 'true';
  document.documentElement.dataset.cm5 = String(useCM5);

  // Markdown renderer — wikilink extension
  (window as any).marked.use({
    renderer: {
      code(code: any, lang: string) {
        let codeStr, langStr;
        if (typeof code === 'object' && code !== null) { codeStr = code.text || ''; langStr = code.lang || ''; }
        else { codeStr = code || ''; langStr = lang || ''; }
        langStr = (langStr || '').split(/\s+/)[0];
        return false;
      }
    },
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start(src: string) { return src.indexOf('[['); },
      tokenizer(src: string) {
        const m = /^\[\[([^\]|#\n]+)(?:[#|]([^\]\n]+))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], name: m[1].trim(), alias: (m[2] || m[1]).trim() };
      },
      renderer(token: any) {
        const safeName = token.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeAlias = token.alias.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<a href="#" class="wikilink" data-wiki="${safeName}">${safeAlias}</a>`;
      }
    }]
  });

  // CodeMirror: frontmatter-aware markdown mode
  (window as any).CodeMirror.defineMode('markdown-fm', function(config: any) {
    const md = (window as any).CodeMirror.getMode(config, {name: 'markdown', highlightFormatting: true});
    return {
      startState() { return {phase: 'start', md: (window as any).CodeMirror.startState(md)}; },
      copyState(s: any) { return {phase: s.phase, md: (window as any).CodeMirror.copyState(md, s.md)}; },
      token(stream: any, state: any) {
        if ((state.phase === 'start' || state.phase === 'fm') && stream.sol()) {
          if (stream.match(/^---\s*$/, false)) {
            stream.skipToEnd();
            state.phase = state.phase === 'start' ? 'fm' : 'md';
            return 'meta';
          }
          if (state.phase === 'start') state.phase = 'md';
        }
        if (state.phase === 'fm') { stream.skipToEnd(); return 'variable-2'; }
        return md.token(stream, state.md);
      },
      blankLine(state: any) { if (state.phase === 'md' && md.blankLine) md.blankLine(state.md); },
      innerMode(state: any) { return state.phase === 'md' ? {state: state.md, mode: md} : {state, mode: this}; },
    };
  });

  if (useCM5) {
    st.cmEditor = (window as any).CodeMirror.fromTextArea(document.getElementById('editor'), {
      mode: 'markdown-fm',
      theme: 'webmd',
      lineWrapping: true,
      viewportMargin: 50,
      tabSize: 2,
      indentWithTabs: false,
      autofocus: false,
      extraKeys: { 'Tab': false },
    });
  } else {
    st.cmEditor = makeTextareaEditor(document.getElementById('editor') as HTMLTextAreaElement);
  }
  st.cmEditor.scrollIntoView = () => {};
  const origScrollTo = st.cmEditor.scrollTo;
  st.cmEditor.scrollTo = (...args: any[]) => {
    console.log('[cmEditor.scrollTo] called', args, new Error().stack);
    return origScrollTo.apply(st.cmEditor, args);
  };
}
