// Popover CSS — extracted from popover.ts so the main file stays
// focused on DOM construction. This is a single template literal
// applied inside the popover's closed Shadow DOM; the host page can't
// see, modify, or be affected by it.

export const POPOVER_STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  @keyframes inkwell-pop-in {
    from { opacity: 0; transform: translateY(6px) scale(0.985); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes inkwell-caret {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0; }
  }
  @keyframes inkwell-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes inkwell-thinking {
    0%, 80%, 100% { opacity: .25; transform: translateY(0); }
    40%           { opacity: 1;   transform: translateY(-3px); }
  }
  @keyframes inkwell-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .pop {
    /* One modern, professional UI font for the whole popover. Every control
       below pulls from this variable so nothing silently falls back to a UA
       default — an unstyled <textarea>, for one, renders in monospace. */
    --inkwell-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      Roboto, "Helvetica Neue", Arial, sans-serif;
    pointer-events: auto;
    position: fixed;
    width: 420px;
    max-width: calc(100vw - 16px);
    max-height: min(620px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    background: #ffffff;
    color: #18181b;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.06),
      0 12px 32px -4px rgba(0, 0, 0, 0.16),
      0 24px 56px -12px rgba(0, 0, 0, 0.22);
    overflow: hidden;
    font-family: var(--inkwell-font);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    caret-color: #6366f1;
    animation: inkwell-pop-in 160ms cubic-bezier(.2,.8,.2,1) both;
  }
  .pop:focus { outline: none; }
  .pop ::selection { background: rgba(99, 102, 241, 0.22); }

  /* Header ----------------------------------------------------- */
  /* The header doubles as a drag handle. cursor:grab invites the
     gesture; touch-action:none keeps mobile / pen pointers from
     scrolling the page mid-drag; user-select:none stops the title
     from being highlighted by a drag start. Child buttons re-claim
     their own pointer cursor below. */
  .head {
    display: flex; align-items: center; gap: 9px;
    padding: 11px 14px;
    border-bottom: 1px solid #ececef;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  .head.dragging { cursor: grabbing; }
  .head .icon-btn,
  .head .brand-icon { cursor: pointer; }
  .head .brand-icon { cursor: grab; }
  .head.dragging .brand-icon { cursor: grabbing; }
  /* Grip dots — visible on hover, fade in to confirm drag is supported.
     Sits to the left of the brand mark without shifting the layout. */
  .grip {
    color: #cbd5e1;
    display: inline-flex; align-items: center;
    width: 12px; flex-shrink: 0;
    opacity: 0;
    transition: opacity 140ms;
  }
  .head:hover .grip,
  .head.dragging .grip { opacity: 1; }
  .grip svg { width: 12px; height: 12px; }
  .brand-icon {
    width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 7px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    color: #fff;
    flex-shrink: 0;
  }
  .brand-icon svg { width: 14px; height: 14px; }
  .title {
    font-size: 13px; font-weight: 650; color: #0f172a;
    letter-spacing: -0.01em;
  }
  .title-sub {
    font-size: 11px; color: #71717a; font-weight: 400; margin-top: 1px;
  }
  .head-spacer { flex: 1; }
  .icon-btn {
    appearance: none; background: transparent; border: 0;
    width: 28px; height: 28px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 6px; color: #64748b; cursor: pointer;
    transition: background 120ms, color 120ms;
  }
  .icon-btn:hover { background: #f1f5f9; color: #0f172a; }
  .icon-btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
  .icon-btn svg { width: 14px; height: 14px; }

  /* Body ------------------------------------------------------- */
  .body {
    padding: 12px 14px;
    overflow: auto;
  }

  /* Action segmented control */
  .actions {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px;
    padding: 4px;
    background: #f4f4f5; border-radius: 10px;
    margin-bottom: 12px;
  }
  .action {
    appearance: none; border: 0;
    display: inline-flex; align-items: center; justify-content: center;
    gap: 5px;
    padding: 7px 4px; border-radius: 7px;
    background: transparent; color: #52525b;
    font-family: var(--inkwell-font);
    font-size: 11.5px; font-weight: 500; line-height: 1;
    white-space: nowrap; overflow: hidden;
    cursor: pointer;
    transition: background 120ms, color 120ms, box-shadow 120ms;
  }
  .action:hover { color: #18181b; }
  .action[aria-selected="true"] {
    background: #ffffff; color: #4f46e5;
    box-shadow:
      0 1px 3px rgba(0,0,0,0.10),
      0 0 0 1px rgba(0,0,0,0.03);
  }
  .action svg { width: 13px; height: 13px; }
  .action:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }

  .action-hint {
    margin: 2px 2px 4px; font-size: 11px; color: #71717a; line-height: 1.45;
  }

  /* "Your text" box — shown for selection / manual-entry mode */
  .source-wrap { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
  .source {
    width: 100%; min-height: 70px; max-height: 180px;
    padding: 8px 10px;
    border: 1px solid #e4e4e7; border-radius: 8px;
    background: #ffffff; color: #18181b;
    font-family: var(--inkwell-font);
    font-size: 13px; line-height: 1.45;
    resize: vertical;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .source:focus {
    outline: none; border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,.18);
  }
  .source::placeholder { color: #a1a1aa; }

  /* Options disclosure — collapses language + tone/model + instruction so
     the popover's primary surface is text in → result out. The whole
     disclosure is one bordered card; the toggle is its borderless header,
     and the body slides open inside the same frame. A grid-template-rows
     0fr → 1fr animation gives a smooth, content-aware expand without any
     hard-coded max-height. */
  .opts {
    margin-bottom: 10px;
    border: 1px solid #e4e4e7; border-radius: 10px;
    background: #ffffff;
    transition: border-color 160ms;
  }
  .opts:hover { border-color: #d4d4d8; }
  .opts-toggle {
    appearance: none;
    width: 100%;
    display: flex; align-items: center; gap: 9px;
    padding: 10px 12px;
    background: transparent; border: 0; border-radius: 10px;
    color: #52525b; cursor: pointer;
    font-family: var(--inkwell-font);
    font-size: 12px; font-weight: 500; line-height: 1.3;
    text-align: left;
    transition: color 120ms;
  }
  .opts-toggle:hover { color: #18181b; }
  .opts-toggle:focus-visible {
    outline: 2px solid #6366f1; outline-offset: -2px;
  }
  .opts-icon, .opts-chevron {
    display: inline-flex; align-items: center;
    color: #a1a1aa; flex-shrink: 0;
    transition: color 120ms;
  }
  .opts-icon svg, .opts-chevron svg { width: 14px; height: 14px; }
  .opts-toggle:hover .opts-icon,
  .opts-toggle:hover .opts-chevron { color: #71717a; }
  .opts-text {
    flex: 1; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .opts-chevron {
    transition: transform 260ms cubic-bezier(.4,0,.2,1), color 120ms;
  }
  .opts-toggle[aria-expanded="true"] .opts-chevron { transform: rotate(180deg); }

  .opts-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 260ms cubic-bezier(.4,0,.2,1);
  }
  .opts-toggle[aria-expanded="true"] + .opts-body {
    grid-template-rows: 1fr;
  }
  .opts-inner {
    min-height: 0; overflow: hidden;
    padding: 12px 12px 2px;
    border-top: 1px solid transparent;
    transition: border-top-color 200ms;
  }
  .opts-toggle[aria-expanded="true"] + .opts-body .opts-inner {
    border-top-color: #ececef;
  }
  /* The wrapped rows already provide their own bottom margin — drop the
     final margin so the card closes flush. */
  .opts-inner > :last-child { margin-bottom: 0; }

  /* Control rows — the language pair and the tone/model settings.
     Every configuration control uses the same .lang-field + .lang-select. */
  .lang-row {
    display: flex; align-items: flex-end; gap: 8px;
    margin-bottom: 10px;
  }
  .lang-field {
    display: flex; flex-direction: column; gap: 5px;
    flex: 1; min-width: 0;
  }
  .lang-field-label {
    font-size: 10px; font-weight: 600; color: #71717a;
    text-transform: uppercase; letter-spacing: .045em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .lang-detected {
    color: #6366f1; text-transform: none; letter-spacing: 0;
  }
  .lang-select {
    width: 100%; min-width: 0;
    appearance: none;
    border: 1px solid #e4e4e7; border-radius: 8px;
    background-color: #ffffff; color: #18181b;
    padding: 8px 28px 8px 10px;
    font-family: var(--inkwell-font);
    font-size: 12.5px; font-weight: 500; line-height: 1.3;
    cursor: pointer;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888890' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>");
    background-repeat: no-repeat;
    background-position: right 9px center;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .lang-select:hover { border-color: #a1a1aa; }
  .lang-select:focus-visible {
    outline: none; border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,.18);
  }
  .lang-select:disabled { opacity: .55; cursor: not-allowed; }
  .lang-arrow {
    color: #a1a1aa; flex-shrink: 0;
    display: inline-flex; align-items: center;
    padding-bottom: 9px;
  }
  .lang-arrow svg { width: 14px; height: 14px; }

  /* Instruction textarea */
  .instruction-wrap { position: relative; }
  .instruction {
    width: 100%; min-height: 60px; max-height: 140px;
    padding: 8px 10px;
    border: 1px solid #e4e4e7; border-radius: 8px;
    background: #ffffff; color: #18181b;
    font-family: var(--inkwell-font);
    font-size: 13px; line-height: 1.45;
    resize: vertical;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .instruction:focus {
    outline: none;
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,.18);
  }
  .instruction::placeholder { color: #a1a1aa; }
  .char-count {
    position: absolute; right: 8px; bottom: 6px;
    font-size: 10px; color: #a1a1aa; pointer-events: none;
    background: rgba(255,255,255,0.85); padding: 0 4px; border-radius: 4px;
  }
  .char-count.warn { color: #ea580c; }
  .char-count.over { color: #dc2626; }

  /* Preview */
  .preview-wrap {
    margin-top: 12px; padding: 12px;
    background: #fafafa;
    border: 1px solid #e4e4e7; border-radius: 10px;
    min-height: 78px;
    max-height: 240px; overflow: auto;
    position: relative;
    transition: background 120ms, border-color 120ms;
  }
  .preview-wrap[data-state="empty"] { background: transparent; border-style: dashed; }
  .preview-wrap[data-state="streaming"] { border-color: #c7d2fe; background: #f6f5ff; }
  .preview-wrap[data-state="error"] { border-color: #fecaca; background: #fef2f2; }
  .preview {
    color: #18181b;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--inkwell-font);
    font-size: 13px; line-height: 1.6;
  }
  .preview-empty { color: #a1a1aa; }
  .caret::after {
    content: "";
    display: inline-block; width: 1px; height: 1.05em;
    background: #6366f1; vertical-align: -2px; margin-left: 1px;
    animation: inkwell-caret 1s steps(1) infinite;
  }

  /* Pre-token "thinking" state — an animated indicator instead of dead text. */
  .thinking {
    display: inline-flex; align-items: center; gap: 7px;
    color: #71717a;
  }
  .thinking-dots { display: inline-flex; gap: 4px; }
  .thinking-dots i {
    display: block; width: 5px; height: 5px;
    border-radius: 50%; background: #6366f1;
    animation: inkwell-thinking 1.1s ease-in-out infinite;
  }
  .thinking-dots i:nth-child(2) { animation-delay: .15s; }
  .thinking-dots i:nth-child(3) { animation-delay: .30s; }

  .err {
    margin-top: 8px;
    font-size: 12px; color: #b91c1c; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  }
  .err svg { flex-shrink: 0; width: 14px; height: 14px; margin-top: 1px; }
  .inkwell-error-cta {
    appearance: none; border: 1px solid #fca5a5; background: #fef2f2;
    color: #b91c1c; font: inherit; font-weight: 600; font-size: 11.5px;
    padding: 4px 10px; border-radius: 8px; cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
    margin-left: auto;
  }
  .inkwell-error-cta:hover { background: #fee2e2; border-color: #f87171; }
  .inkwell-error-cta:focus-visible { outline: 2px solid #ef4444; outline-offset: 1px; }

  /* Footer ----------------------------------------------------- */
  .footer {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid #f1f5f9;
    background: #fafafa;
  }
  .meta {
    flex: 1; font-size: 11px; color: #a1a1aa; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .kbd {
    display: inline-flex; align-items: center; gap: 1px;
    font: 500 10px/1 ui-monospace, "SF Mono", Menlo, monospace;
    color: #71717a;
    background: #ffffff;
    border: 1px solid #e4e4e7; border-radius: 4px;
    padding: 2px 4px;
    margin-left: 4px;
  }
  .btn {
    appearance: none; border: 0; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 12px; border-radius: 8px;
    font-family: var(--inkwell-font);
    font-size: 13px; font-weight: 500; line-height: 1;
    transition: background 120ms, color 120ms, transform 80ms, box-shadow 120ms;
  }
  .btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
  .btn:active { transform: translateY(0.5px); }
  .btn[disabled] { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn svg { width: 14px; height: 14px; }
  .btn-primary {
    background: #18181b; color: #ffffff;
  }
  .btn-primary:hover:not([disabled]) { background: #000000; }
  .btn-primary.accent {
    background: #6366f1;
  }
  .btn-primary.accent:hover:not([disabled]) { background: #4f46e5; }
  .btn-secondary {
    background: #ffffff; color: #18181b; border: 1px solid #e4e4e7;
  }
  .btn-secondary:hover:not([disabled]) {
    background: #f4f4f5; border-color: #d4d4d8;
  }

  .spin svg { animation: inkwell-spin 0.9s linear infinite; }

  /* Slim, unobtrusive scrollbars on every scrollable region — the chunky
     OS default scrollbar reads as unpolished inside a compact popover. */
  .body, .preview-wrap, .source, .instruction {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.22) transparent;
  }
  .body::-webkit-scrollbar,
  .preview-wrap::-webkit-scrollbar,
  .source::-webkit-scrollbar,
  .instruction::-webkit-scrollbar { width: 10px; height: 10px; }
  .body::-webkit-scrollbar-thumb,
  .preview-wrap::-webkit-scrollbar-thumb,
  .source::-webkit-scrollbar-thumb,
  .instruction::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.20);
    border: 3px solid transparent;
    border-radius: 9999px;
    background-clip: padding-box;
  }
  .body::-webkit-scrollbar-thumb:hover,
  .preview-wrap::-webkit-scrollbar-thumb:hover,
  .source::-webkit-scrollbar-thumb:hover,
  .instruction::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.34);
    background-clip: padding-box;
  }
  .body::-webkit-scrollbar-track,
  .preview-wrap::-webkit-scrollbar-track,
  .source::-webkit-scrollbar-track,
  .instruction::-webkit-scrollbar-track { background: transparent; }

  /* Dark mode ---------------------------------------------- */
  @media (prefers-color-scheme: dark) {
    .pop {
      background: #18181b; color: #f4f4f5;
      border-color: rgba(255,255,255,0.08);
      box-shadow:
        0 2px 6px rgba(0,0,0,0.5),
        0 12px 32px -4px rgba(0,0,0,0.55),
        0 24px 56px -12px rgba(0,0,0,0.7);
    }
    .head { border-color:#27272a; }
    .grip { color:#52525b; }
    .title { color:#f4f4f5; } .title-sub { color:#a1a1aa; }
    .icon-btn { color:#a1a1aa; } .icon-btn:hover { background:#27272a; color:#f4f4f5; }
    .actions { background:#27272a; }
    .action { color:#a1a1aa; }
    .action:hover { color:#f4f4f5; }
    .action[aria-selected="true"] {
      background:#3f3f46; color:#c7d2fe;
      box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05);
    }
    .action-hint { color: #a1a1aa; }
    .source { background:#1c1c1f; border-color:#3f3f46; color:#f4f4f5; }
    .source:focus { border-color:#818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.22); }
    .source::placeholder { color:#71717a; }
    .lang-field-label { color:#a1a1aa; }
    .lang-detected { color:#a5b4fc; }
    .lang-select { background-color:#1c1c1f; border-color:#3f3f46; color:#f4f4f5; }
    .lang-select:hover { border-color:#52525b; }
    .lang-select:focus-visible { border-color:#818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.22); }
    .lang-arrow { color:#52525b; }
    .instruction { background:#1c1c1f; border-color:#3f3f46; color:#f4f4f5; }
    .instruction:focus { border-color:#818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.22); }
    .instruction::placeholder { color:#71717a; }
    .char-count { background: rgba(24,24,27,0.85); color:#71717a; }
    .preview-wrap { background:#1f1f23; border-color:#3f3f46; }
    .preview-wrap[data-state="empty"] { background: transparent; }
    .preview-wrap[data-state="streaming"] { border-color:#4338ca; background:#1e1b35; }
    .preview-wrap[data-state="error"] { border-color:#7f1d1d; background:#1c0f10; }
    .preview { color:#f4f4f5; }
    .preview-empty { color:#71717a; }
    .err { color:#fca5a5; }
    .inkwell-error-cta {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.45);
      color: #fecaca;
    }
    .inkwell-error-cta:hover { background: rgba(239, 68, 68, 0.22); border-color: rgba(248, 113, 113, 0.6); }
    .footer { background:#1c1c1f; border-color:#27272a; }
    .meta { color:#71717a; }
    .kbd { background:#27272a; border-color:#3f3f46; color:#a1a1aa; }
    .btn-primary { background:#f4f4f5; color:#18181b; }
    .btn-primary:hover:not([disabled]) { background:#ffffff; }
    .btn-primary.accent { background:#818cf8; color:#0a0a0a; }
    .btn-primary.accent:hover:not([disabled]) { background:#a5b4fc; }
    .btn-secondary { background:#27272a; color:#f4f4f5; border-color:#3f3f46; }
    .btn-secondary:hover:not([disabled]) { background:#3f3f46; border-color:#52525b; }
    .pop { caret-color:#818cf8; }
    .pop ::selection { background: rgba(129,140,248,0.32); }
    .thinking { color:#a1a1aa; }
    .thinking-dots i { background:#818cf8; }
    .body, .preview-wrap, .source, .instruction {
      scrollbar-color: rgba(255,255,255,0.22) transparent;
    }
    .body::-webkit-scrollbar-thumb,
    .preview-wrap::-webkit-scrollbar-thumb,
    .source::-webkit-scrollbar-thumb,
    .instruction::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); }
    .body::-webkit-scrollbar-thumb:hover,
    .preview-wrap::-webkit-scrollbar-thumb:hover,
    .source::-webkit-scrollbar-thumb:hover,
    .instruction::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.30); }
    .opts { background:#1a1a1d; border-color:#3f3f46; }
    .opts:hover { border-color:#52525b; }
    .opts-toggle { color:#a1a1aa; }
    .opts-toggle:hover { color:#f4f4f5; }
    .opts-icon, .opts-chevron { color:#71717a; }
    .opts-toggle:hover .opts-icon,
    .opts-toggle:hover .opts-chevron { color:#a1a1aa; }
    .opts-toggle[aria-expanded="true"] + .opts-body .opts-inner {
      border-top-color:#27272a;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .pop { animation: none; }
    .caret::after { animation: none; opacity: 1; }
    .spin svg { animation: none; }
    .thinking-dots i { animation: none; opacity: 1; }
    .opts-body, .opts-chevron { transition: none; }
  }
`;
