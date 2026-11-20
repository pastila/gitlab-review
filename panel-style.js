const ownerFilterStyle = new CSSStyleSheet();

ownerFilterStyle.replaceSync(`
  :host {
    display: block;
    --surface: var(--gl-background-color-default, light-dark(#fff, #222));
    --raised: var(--gl-background-color-subtle, light-dark(#f6f7fa, #303030));
    --border: var(--gl-border-color-default, light-dark(#d5d6db, #545459));
    --focus: var(--gl-focus-ring-color, #617ae0);
    font: inherit;
    color: inherit;
  }

  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    min-width: 0;
  }

  .control {
    min-height: 32px;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .control:hover, .option:hover { background: var(--raised); }
  .picker-toggle { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picker-toggle::after { content: "▾"; margin-inline-start: 6px; }

  .options {
    position: fixed;
    inset: 0;
    margin: auto;
    width: min(320px, 80vw);
    max-height: min(320px, 50dvh);
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: inherit;
    box-shadow: 0 4px 12px light-dark(#1d263826, #0006);
  }

  @supports (position-area: block-end span-inline-end) {
    .options {
      inset: auto;
      margin: 4px;
      position-area: block-end span-inline-end;
      justify-self: start;
      align-self: start;
      position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;
    }
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 4px;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .option input { flex: 0 0 auto; margin: 3px 0 0; accent-color: var(--focus); }
  .reset { font: inherit; color: inherit; background: transparent; border: 0; text-align: start; }
  .reset[aria-pressed="true"] { background: var(--raised); font-weight: 600; }
  .jump { width: min(340px, 100%); min-width: 0; }
  .status { font-size: 12px; }
  .status:empty { display: none; }
  .options-status { padding: 6px 8px; }
  [data-busy]::before {
    content: "";
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-inline-end: 6px;
    border: 2px solid var(--border);
    border-block-start-color: var(--focus);
    border-radius: 50%;
    vertical-align: -2px;
    animation: loading-spin 800ms linear infinite;
  }
  @keyframes loading-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { [data-busy]::before { animation: none; } }

  .file-tree { padding: 2px 4px; }
  .tree-list { margin: 0; padding: 0; list-style: none; }
  .tree-list .tree-list {
    margin-inline-start: 10px;
    padding-inline-start: 4px;
    border-inline-start: 1px solid var(--border);
  }
  .tree-folder > summary, .tree-file {
    min-height: 28px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .tree-folder > summary { font-weight: 600; }
  .tree-file { display: block; color: inherit; text-decoration: none; }
  .tree-folder > summary:hover, .tree-file:hover, .tree-file:focus-visible { background: var(--raised); }
  .tree-name, .tree-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-file .tree-name, .tree-path { display: block; }
  .tree-path, .tree-empty { color: var(--gl-text-color-subtle, light-dark(#62656d, #a0a3ac)); }
  .tree-path { font-size: 11px; }
  .tree-empty { margin: 4px; }
`);
