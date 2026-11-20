const reviewPanelStyle = new CSSStyleSheet();

reviewPanelStyle.replaceSync(`
  :host {
    all: initial;
    color-scheme: light dark;
    --surface: light-dark(#fff, #1e2025);
    --raised: light-dark(#f6f7fa, #282b33);
    --ink: light-dark(#1d2638, #edf0f6);
    --muted: light-dark(#515e73, #aab4c8);
    --border: light-dark(#dce2ec, #414653);
    --accent: light-dark(#2b4db4, #a9baff);
    --selection: light-dark(#eaf0ff, #333f65);
    --add: light-dark(#edf9ef, #183428);
    --add-ink: light-dark(#185d36, #9de5ad);
    --remove: light-dark(#fff0ee, #402629);
    --remove-ink: light-dark(#942c2b, #ffb6ac);
    --warning: light-dark(#fff5db, #392e17);
    --warning-ink: light-dark(#64420a, #f4d481);
    font: 14px/1.45 system-ui, sans-serif;
    color: var(--ink);
  }

  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: wait; opacity: .6; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .trigger {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 1050;
    padding: 9px 15px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: light-dark(#2b4db4, #b5c4ff);
    color: light-dark(#fff, #192449);
    font-weight: 650;
    box-shadow: 0 3px 14px #17244135;
  }

  .trigger:hover { background: light-dark(#233d91, #ced8ff); }

  .panel {
    position: fixed;
    inset: 0 0 0 auto;
    margin: 0;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--border);
    width: min(1130px, 95vw);
    max-width: none;
    height: 100dvh;
    max-height: none;
    background: var(--surface);
    color: var(--ink);
    box-shadow: -10px 0 32px #11182740;
    overflow: hidden;
  }

  .panel[open] { display: flex; flex-direction: column; }
  .panel::backdrop { background: #11182770; }

  .panel-header, .file-header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }

  .panel-header { justify-content: space-between; padding: 14px 20px; }
  .heading, .actions { display: flex; align-items: center; gap: 10px; }
  .heading h1 { margin: 0; font-size: 18px; font-weight: 700; }
  .mr-number { color: var(--muted); font-variant-numeric: tabular-nums; }

  .control, select, input {
    min-height: 34px;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .control:hover:enabled { background: var(--raised); }
  .close { width: 34px; padding: 0; font-size: 22px; line-height: 1; }

  .message {
    flex-shrink: 0;
    margin: 0;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--raised);
  }

  .message.warning { background: var(--warning); color: var(--warning-ink); }
  .message.error { background: var(--remove); color: var(--remove-ink); }

  .workspace {
    display: grid;
    grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  .sidebar, .viewer { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .sidebar { border-right: 1px solid var(--border); background: var(--raised); }
  .filters { display: grid; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border); }
  .filters label { font-size: 12px; font-weight: 650; }
  .filters input, .filters select { min-width: 0; width: 100%; }
  .filters input::placeholder { color: var(--muted); opacity: 1; }
  .file-count { margin: 0; font-size: 12px; color: var(--muted); }

  .file-list { overflow: auto; flex: 1; margin: 0; padding: 6px; list-style: none; }
  .file-list li + li { margin-top: 2px; }

  .file-button {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 6px;
    text-align: left;
  }

  .file-button:hover { background: var(--surface); }
  .file-button[aria-current="true"] { background: var(--selection); border-color: var(--border); }
  .file-name { display: grid; min-width: 0; }
  .file-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .basename { font-size: 13px; font-weight: 600; }
  .directory { font-size: 11px; color: var(--muted); }

  .badge {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    width: 21px;
    height: 21px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--muted);
    font: 600 11px/1 system-ui, sans-serif;
  }

  .status-A { background: var(--add); color: var(--add-ink); }
  .status-D { background: var(--remove); color: var(--remove-ink); }
  .status-R, .status-C { background: var(--selection); color: var(--accent); }

  .file-header { padding: 12px 16px; }
  .file-title { margin: 0; overflow-wrap: anywhere; font: 600 12px/1.5 ui-monospace, monospace; }
  .patch { flex: 1; min-height: 0; overflow: auto; }
  .placeholder { color: var(--muted); margin: 16px; }

  .diff {
    margin: 0;
    width: max-content;
    min-width: 100%;
    font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
    tab-size: 4;
  }

  .diff-line { display: flex; }
  .diff-line.addition { background: var(--add); color: var(--add-ink); }
  .diff-line.deletion { background: var(--remove); color: var(--remove-ink); }
  .diff-line.meta { background: var(--raised); color: var(--muted); }
  .line-numbers { display: flex; flex: 0 0 auto; user-select: none; }
  .line-numbers > span { min-width: 43px; padding: 0 5px; text-align: right; color: var(--muted); }
  .line-code { border-left: 1px solid var(--border); padding: 0 10px; white-space: pre; }

  @media (max-width: 680px) {
    .panel { width: 100vw; }
    .workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 39%) minmax(0, 1fr); }
    .sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
    .panel-header { padding-inline: 12px; }
    .filters { padding: 7px 12px; gap: 5px; }
  }
`);
