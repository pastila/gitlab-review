(() => {
  const allSections = "all";
  const statusNames = { A: "Добавлен", D: "Удалён", R: "Переименован", C: "Скопирован", M: "Изменён" };
  let active;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, label) {
    const node = element("button", className, label);
    node.type = "button";
    return node;
  }

  function fileBadge(file) {
    const badge = element("span", `badge status-${file.status}`, file.status);
    badge.title = statusNames[file.status];
    badge.setAttribute("aria-label", badge.title);
    return badge;
  }

  function diffElement(lines) {
    const diff = element("pre", "diff");
    const rows = document.createDocumentFragment();
    let oldLine;
    let newLine;

    for (const text of lines) {
      const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      const prefix = text[0];
      let left = "";
      let right = "";
      let kind = "meta";

      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
      } else if (prefix === "+") {
        kind = "addition";
        right = newLine++;
      } else if (prefix === "-") {
        kind = "deletion";
        left = oldLine++;
      } else if (prefix === " ") {
        kind = "context";
        left = oldLine++;
        right = newLine++;
      }

      const row = element("span", `diff-line ${kind}`);
      const numbers = element("span", "line-numbers");
      numbers.setAttribute("aria-hidden", "true");
      numbers.append(element("span", "", left), element("span", "", right));
      row.append(numbers, element("span", "line-code", text));
      rows.append(row);
    }

    diff.append(rows);
    return diff;
  }

  function mount(context) {
    const host = element("div");
    host.id = "raketa-mr-review";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [reviewPanelStyle];

    const trigger = button("trigger", "Файлы команды");
    trigger.lang = "ru";
    trigger.setAttribute("aria-haspopup", "dialog");
    const dialog = element("dialog", "panel");
    dialog.lang = "ru";
    dialog.setAttribute("aria-labelledby", "review-title");
    const header = element("header", "panel-header");
    const title = element("h1", "", "Файлы команды");
    title.id = "review-title";
    const heading = element("div", "heading");
    heading.append(title, element("span", "mr-number", `!${context.iid}`));

    const refresh = button("control", "Обновить");
    const close = button("control close", "×");
    close.setAttribute("aria-label", "Закрыть панель");
    close.title = "Закрыть панель (Esc)";
    close.autofocus = true;
    const actions = element("div", "actions");
    actions.append(refresh, close);
    header.append(heading, actions);

    const message = element("p", "message");
    message.setAttribute("role", "status");
    message.hidden = true;
    const workspace = element("div", "workspace");
    workspace.hidden = true;
    const sidebar = element("aside", "sidebar");
    sidebar.setAttribute("aria-label", "Файлы МР");
    const filters = element("div", "filters");
    const sectionLabel = element("label", "", "Секция CODEOWNERS");
    sectionLabel.htmlFor = "owner-section";
    const sectionSelect = element("select");
    sectionSelect.id = "owner-section";
    const search = element("input");
    search.type = "search";
    search.placeholder = "Поиск по пути";
    search.setAttribute("aria-label", "Поиск по пути");
    const count = element("p", "file-count");
    count.setAttribute("aria-live", "polite");
    filters.append(sectionLabel, sectionSelect, search, count);
    const fileList = element("ul", "file-list");
    sidebar.append(filters, fileList);

    const viewer = element("section", "viewer");
    viewer.setAttribute("aria-label", "Изменения файла");
    const fileHeader = element("header", "file-header");
    const patch = element("div", "patch");
    patch.tabIndex = 0;
    patch.setAttribute("aria-label", "Diff файла");
    viewer.append(fileHeader, patch);
    workspace.append(sidebar, viewer);
    dialog.append(header, message, workspace);
    shadow.append(trigger, dialog);

    const storageKey = `codeowners-section:${context.project}`;
    let loaded;
    let selected;
    let selectedButton;
    let controller;

    function showMessage(text, kind = "") {
      message.textContent = text;
      message.className = `message ${kind}`;
      message.hidden = !text;
    }

    function showFile(file, node) {
      selectedButton?.removeAttribute("aria-current");
      selectedButton = node;
      node?.setAttribute("aria-current", "true");
      selected = file;
      fileHeader.replaceChildren();
      fileHeader.hidden = !file;
      if (!file) {
        patch.replaceChildren(element("p", "placeholder", "По выбранным условиям файлов нет."));
        return;
      }

      const path = file.oldPath === file.newPath ? file.path : `${file.oldPath} → ${file.newPath}`;
      fileHeader.append(fileBadge(file), element("h2", "file-title", path));
      let contents;
      if (file.binary) {
        contents = element("p", "placeholder", "Бинарный файл.");
      } else if (file.changes.length) {
        contents = diffElement(file.changes);
      } else {
        contents = element("p", "placeholder", "В этом файле нет текстовых изменений.");
      }
      patch.replaceChildren(contents);
      patch.scrollTo(0, 0);
    }

    function renderFiles() {
      const value = sectionSelect.value;
      const query = search.value.trim().toLowerCase();
      const files = loaded.files.filter(file => {
        const inSection = value === allSections || file.sections.some(section => `section:${section.key}` === value);
        return inSection && [file.oldPath, file.newPath].some(path => path.toLowerCase().includes(query));
      });
      count.textContent = `${files.length} из ${loaded.files.length} файлов`;
      const rows = document.createDocumentFragment();
      const nextFile = files.includes(selected) ? selected : files[0];
      let nextButton;

      for (const file of files) {
        const row = element("li");
        const node = button("file-button", "");
        const slash = file.path.lastIndexOf("/");
        const names = element("span", "file-name");
        names.append(element("span", "basename", file.path.slice(slash + 1)));
        if (slash !== -1) names.append(element("span", "directory", file.path.slice(0, slash + 1)));
        node.title = file.path;
        node.append(fileBadge(file), names);
        node.addEventListener("click", () => {
          if (selected !== file) showFile(file, node);
        });
        if (file === nextFile) nextButton = node;
        row.append(node);
        rows.append(row);
      }

      fileList.replaceChildren(rows);
      if (nextFile && nextFile === selected) {
        selectedButton = nextButton;
        selectedButton.setAttribute("aria-current", "true");
      } else {
        showFile(nextFile, nextButton);
      }
    }

    function render(result, preference) {
      loaded = result;
      const totals = new Map();
      for (const file of loaded.files) {
        for (const { key } of file.sections) totals.set(key, (totals.get(key) ?? 0) + 1);
      }
      const all = new Option(`Все файлы · ${loaded.files.length}`, allSections);
      const options = loaded.sections.map(({ key, label }) => new Option(`${label} · ${totals.get(key) ?? 0}`, `section:${key}`));
      sectionSelect.replaceChildren(all, ...options);
      sectionSelect.value = options.some(option => option.value === preference) ? preference : allSections;
      sectionSelect.disabled = !options.length;
      workspace.hidden = false;
      renderFiles();

      const warnings = [];
      if (result.incomplete) warnings.push(`GitLab сообщил об изменениях в ${result.expected} файлах, получено ${result.files.length}.`);
      if (!options.length) warnings.push(`В ветке ${result.targetBranch} нет секций или правил CODEOWNERS.`);
      showMessage(warnings.join(" "), "warning");
    }

    async function load() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      refresh.disabled = true;
      workspace.hidden = true;
      showMessage("Загружаем изменения МР…");
      try {
        const [result, values] = await Promise.all([
          reviewData.loadReview(context, current.signal),
          chrome.storage.local.get(storageKey).catch(() => ({})),
        ]);
        if (current.signal.aborted) return;
        render(result, values[storageKey]);
      } catch (error) {
        if (current.signal.aborted) return;
        loaded = undefined;
        showMessage(error instanceof Error ? error.message : "Не удалось загрузить изменения МР.", "error");
      } finally {
        if (controller === current) refresh.disabled = false;
      }
    }

    trigger.addEventListener("click", () => {
      dialog.showModal();
      if (!loaded && !refresh.disabled) void load();
    });
    close.addEventListener("click", () => dialog.close());
    refresh.addEventListener("click", () => void load());
    sectionSelect.addEventListener("change", () => {
      void chrome.storage.local.set({ [storageKey]: sectionSelect.value }).catch(() => {});
      renderFiles();
    });
    search.addEventListener("input", renderFiles);
    document.body.append(host);

    return () => {
      controller?.abort();
      dialog.close();
      host.remove();
    };
  }

  function update() {
    const context = reviewData.mergeRequestFromPath(location.pathname);
    const key = context ? `${context.project}!${context.iid}` : null;
    if (key === (active?.key ?? null)) return;
    active?.dispose();
    active = context ? { key, dispose: mount(context) } : null;
  }

  update();
  if (window.navigation) window.navigation.addEventListener("currententrychange", update);
  else window.addEventListener("popstate", update);
})();
