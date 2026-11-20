(() => {
  const hiddenAttribute = "data-raketa-codeowners-hidden";
  const treeAttribute = "data-raketa-codeowners-compact-tree";
  const treeSelector = '[data-testid="file-tree-container"], .tree-list-holder';
  const listToggleSelector = '[data-testid="list-view-toggle"]';
  const versionParams = ["diff_id", "start_sha", "commit_id", "diff_head"];
  let active;

  function yieldTask() {
    return globalThis.scheduler?.yield?.() ?? new Promise(resolve => setTimeout(resolve, 0));
  }

  function afterPaint() {
    if (document.hidden) return yieldTask();
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  async function forEachSlice(items, visit, signal, paintChanges = false) {
    let deadline = performance.now() + 6;
    let changes = 0;
    for (const item of items) {
      signal.throwIfAborted();
      if (visit(item)) changes++;
      if (paintChanges && changes >= 128) {
        await afterPaint();
        changes = 0;
      } else if (performance.now() >= deadline) {
        await yieldTask();
      } else {
        continue;
      }
      deadline = performance.now() + 6;
    }
    signal.throwIfAborted();
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text) {
    const node = element("button", className, text);
    node.type = "button";
    return node;
  }

  function readData(source) {
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  }

  function pathsKey({ oldPath, newPath }) {
    return JSON.stringify([oldPath, newPath]);
  }

  function metadataUrl(context, root, rapid) {
    const base = reviewData.mergeRequestPath(context);
    const endpoint = rapid ? "diff_files_metadata" : "diffs_metadata.json";
    const url = new URL(`${base}/${endpoint}`, location.origin);
    if (!rapid) url.searchParams.set("diff_head", "true");

    if (rapid) {
      const nativeEndpoint = readData(root.dataset.appData)?.diff_files_endpoint;
      if (typeof nativeEndpoint === "string") {
        const native = new URL(nativeEndpoint, location.origin);
        if (native.origin === url.origin && native.pathname === url.pathname) url.search = native.search;
      }
    }
    const current = new URLSearchParams(location.search);
    for (const key of versionParams) {
      if (current.has(key)) url.searchParams.set(key, current.get(key));
    }
    return url;
  }

  function fileUrl(file, rapid) {
    const url = new URL(location.href);
    for (const key of ["file", "file_path", "old_path", "new_path", "line"]) url.searchParams.delete(key);
    if (rapid) {
      if (file.oldPath === file.newPath) {
        url.searchParams.set("file_path", file.newPath);
      } else {
        url.searchParams.set("old_path", file.oldPath);
        url.searchParams.set("new_path", file.newPath);
      }
    } else if (file.hash) {
      url.searchParams.set("file", file.hash);
    }
    url.hash = file.hash ?? "";
    return url;
  }

  function mountTree(browser, closedFolders, fileHref, openFile) {
    const host = element("div", "raketa-codeowners-tree");
    host.lang = "ru";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [ownerFilterStyle];
    const nav = element("nav", "file-tree");
    nav.setAttribute("aria-label", "Файлы выбранных секций CODEOWNERS");
    shadow.append(nav);
    browser.setAttribute(treeAttribute, "");
    browser.append(host);

    let lastFiles;
    let lastQuery;
    let lastListMode;
    let redrawFrame;
    let drawController;
    let drawing;

    function fileRow(file, showPath) {
      const row = element("li");
      const link = element("a", "tree-file");
      const slash = file.newPath.lastIndexOf("/");
      link.href = fileHref(file);
      link.title = file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`;
      link.append(element("span", "tree-name", file.newPath.slice(slash + 1)));
      if (showPath && slash >= 0) link.append(element("span", "tree-path", file.newPath.slice(0, slash)));
      link.addEventListener("click", event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        void openFile(file);
      });
      row.append(link);
      return row;
    }

    function draw(files) {
      const query = browser.querySelector('input[name="diff-tree-search"], [data-testid="diff-tree-search"] input')?.value.trim() ?? "";
      const listMode = browser.querySelector(listToggleSelector)?.getAttribute("aria-current") === "true";
      if (files === lastFiles && query === lastQuery && listMode === lastListMode) return drawing;
      lastFiles = files;
      lastQuery = query;
      lastListMode = listMode;
      drawController?.abort();
      drawController = new AbortController();
      const signal = drawController.signal;
      drawing = build(files, query, listMode, signal).catch(error => {
        if (!signal.aborted) throw error;
      });
      return drawing;
    }

    async function build(files, query, listMode, signal) {
      const patterns = query.split(",").map(term => term.trim()).filter(Boolean).map(term => {
        const regex = term.split(/(\*+|\?)/).map(part => {
          if (part === "*") return "[^/]*";
          if (part === "?") return "[^/]";
          if (part.startsWith("*")) return ".*";
          return part.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
        }).join("");
        return new RegExp(regex, "i");
      });
      const results = patterns.length ? [] : files;
      if (patterns.length) {
        await forEachSlice(files, file => {
          if (patterns.some(pattern => pattern.test(file.newPath) || pattern.test(file.oldPath))) results.push(file);
        }, signal);
      }
      if (!results.length) {
        const empty = element("p", "tree-empty", "Файлы не найдены.");
        empty.setAttribute("role", "status");
        nav.replaceChildren(empty);
        return;
      }
      const list = element("ul", "tree-list");
      if (listMode) {
        await forEachSlice(results, file => list.append(fileRow(file, true)), signal);
        signal.throwIfAborted();
        nav.replaceChildren(list);
        return;
      }

      const tree = { folders: new Map(), files: [] };
      await forEachSlice(results, file => {
        const parts = file.newPath.split("/");
        parts.pop();
        let parent = tree;
        for (const name of parts) {
          if (!parent.folders.has(name)) parent.folders.set(name, { folders: new Map(), files: [] });
          parent = parent.folders.get(name);
        }
        parent.files.push(file);
      }, signal);

      function* rows(folder, list, parentPath = "") {
        for (const [name, firstChild] of folder.folders) {
          let child = firstChild;
          let label = name;
          while (!child.files.length && child.folders.size === 1) {
            const [[nextName, nextChild]] = child.folders;
            label += `/${nextName}`;
            child = nextChild;
          }
          const path = parentPath + label;
          const nested = element("ul", "tree-list");
          yield { list, nested, label, path };
          yield* rows(child, nested, `${path}/`);
        }
        for (const file of folder.files) yield { list, file };
      }

      await forEachSlice(rows(tree, list), ({ list, file, nested, label, path }) => {
        if (file) {
          list.append(fileRow(file, false));
          return;
        }
        const row = element("li");
        const details = element("details", "tree-folder");
        const heading = element("summary", "tree-name", label);
        heading.title = path;
        details.open = Boolean(query) || !closedFolders.has(path);
        heading.addEventListener("click", () => {
          if (query) return;
          if (details.open) closedFolders.add(path);
          else closedFolders.delete(path);
        });
        details.append(heading, nested);
        row.append(details);
        list.append(row);
      }, signal);
      signal.throwIfAborted();
      nav.replaceChildren(list);
    }

    function updateSearch() {
      if (redrawFrame !== undefined) return;
      redrawFrame = requestAnimationFrame(() => {
        redrawFrame = undefined;
        if (host.isConnected && lastFiles) void draw(lastFiles).catch(() => {});
      });
    }

    browser.addEventListener("input", updateSearch);
    browser.addEventListener("click", updateSearch);
    return {
      host,
      draw,
      dispose() {
        drawController?.abort();
        cancelAnimationFrame(redrawFrame);
        browser.removeEventListener("input", updateSearch);
        browser.removeEventListener("click", updateSearch);
        browser.removeAttribute(treeAttribute);
        host.remove();
      },
    };
  }

  function mount(context, root, rapid, endpoint) {
    const host = element("div");
    host.id = "raketa-codeowners";
    host.lang = "ru";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [ownerFilterStyle];

    const toolbar = element("section", "toolbar");
    toolbar.setAttribute("aria-label", "Фильтр CODEOWNERS");
    const picker = button("control picker-toggle", "CODEOWNERS");
    const options = element("div", "options");
    options.id = "raketa-codeowners-options";
    options.popover = "auto";
    picker.setAttribute("popovertarget", options.id);
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", "Секции CODEOWNERS");
    const optionsStatus = element("div", "options-status");
    options.append(optionsStatus);
    const reset = button("option reset", "Все файлы");

    const jump = element("select", "control jump");
    jump.setAttribute("aria-label", "Перейти к файлу из выбранных секций");
    jump.hidden = true;
    const status = element("span", "status");
    status.setAttribute("role", "status");
    const retry = button("control", "Повторить");
    retry.hidden = true;
    toolbar.append(picker, options, jump, status, retry);
    shadow.append(toolbar);

    if (rapid) root.before(host);
    else root.prepend(host);

    const storageKey = `codeowners-section:${context.project}`;
    const selected = new Set();
    const cardsSelector = rapid ? "diff-file[data-file-data]" : ".diff-file[data-path][id]";
    const pagerSelector = '[data-testid="file-by-file-navigation"]';
    const nativeSelector = `${cardsSelector}, ${pagerSelector}`;
    const drawer = document.getElementById("js-drawer-container");
    const hiddenNodes = new Set();
    const pendingNodes = new Set();
    const nativeNodes = new Set();
    const trees = new Map();
    const closedFolders = new Set();
    let files = [];
    let visibleFiles = [];
    let jumpFiles;
    let sections = [];
    let filesByHash;
    let filesByPaths;
    let controller;
    let filterController;
    let appliedSections = new Set();
    let frame;
    let treesDirty = false;
    let observing = false;
    let ready = false;
    let save = Promise.resolve();

    function showStatus(message, busy = false) {
      status.textContent = message;
      optionsStatus.hidden = !busy && ready && sections.length > 0;
      optionsStatus.textContent = optionsStatus.hidden ? "" : message;
      for (const indicator of [status, optionsStatus]) indicator.toggleAttribute("data-busy", busy);
      options.setAttribute("aria-busy", String(busy));
      jump.disabled = busy;
    }

    function cardFile(card) {
      const known = filesByHash.get(card.id);
      if (known) return known;
      if (!rapid) return null;
      const data = readData(card.dataset.fileData);
      if (!data || typeof data.old_path !== "string" || typeof data.new_path !== "string") return null;
      const paths = { oldPath: data.old_path, newPath: data.new_path };
      return filesByPaths.get(pathsKey(paths)) ?? {
        ...paths,
        owners: reviewData.fileSections(paths.oldPath, paths.newPath, sections),
      };
    }

    function matches(file) {
      return file.owners.some(key => appliedSections.has(key));
    }

    function setHidden(node, hidden) {
      const changed = node.hasAttribute(hiddenAttribute) !== hidden;
      if (changed) node.toggleAttribute(hiddenAttribute, hidden);
      if (hidden) hiddenNodes.add(node);
      else hiddenNodes.delete(node);
      return changed;
    }

    function applyNodeVisibility(node) {
      if (!appliedSections.size) return setHidden(node, false);
      if (node.matches(cardsSelector)) {
        const file = cardFile(node);
        return setHidden(node, Boolean(file && !matches(file)));
      }
      // GitLab's one-file pager uses the complete list. The chooser uses the filtered list.
      return setHidden(node, true);
    }

    function syncTrees() {
      const browsers = new Set(root.querySelectorAll(treeSelector));
      for (const browser of drawer?.querySelectorAll(treeSelector) ?? []) {
        if (browser.closest(".diffs-tree-drawer")) browsers.add(browser);
      }
      for (const [browser, tree] of trees) {
        if (browsers.has(browser) && tree.host.isConnected) continue;
        tree.dispose();
        trees.delete(browser);
      }
      const updates = [];
      for (const browser of browsers) {
        if (!trees.has(browser)) {
          trees.set(browser, mountTree(browser, closedFolders, file => fileUrl(file, rapid), file => openFile(file, browser)));
        }
        updates.push(trees.get(browser).draw(visibleFiles));
      }
      return Promise.all(updates);
    }

    function trackNode(node) {
      nativeNodes.add(node);
      pendingNodes.add(node);
    }

    function releaseNode(node) {
      nativeNodes.delete(node);
      pendingNodes.delete(node);
      if (hiddenNodes.has(node)) setHidden(node, false);
    }

    function scheduleVisibility(records) {
      for (const record of records) {
        if (record.type === "attributes") {
          if (record.target.matches(nativeSelector)) trackNode(record.target);
          if (record.target.matches(listToggleSelector)) treesDirty = true;
          continue;
        }
        // Updates inside a file, such as comment forms and expanded lines, cannot change its owner.
        if (record.target instanceof Element && record.target.closest(cardsSelector)) continue;
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          releaseNode(node);
          if (node.matches(cardsSelector)) continue;
          if (node.matches(`${treeSelector}, .raketa-codeowners-tree`) || node.querySelector(treeSelector)) treesDirty = true;
          for (const child of node.querySelectorAll(nativeSelector)) releaseNode(child);
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(nativeSelector)) trackNode(node);
          if (node.matches(cardsSelector)) continue;
          if (node.matches(treeSelector) || node.querySelector(treeSelector)) treesDirty = true;
          for (const child of node.querySelectorAll(nativeSelector)) trackNode(child);
        }
      }
      if ((!pendingNodes.size && !treesDirty) || frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        for (const node of pendingNodes) {
          if (root.contains(node) || drawer?.contains(node)) applyNodeVisibility(node);
        }
        pendingNodes.clear();
        if (treesDirty) {
          treesDirty = false;
          if (appliedSections.size) void syncTrees().catch(() => {});
        }
      });
    }

    const observer = new MutationObserver(scheduleVisibility);
    const observedChanges = {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-file-data", "data-path", "aria-current"],
    };
    function clearVisibility() {
      observer.disconnect();
      observing = false;
      cancelAnimationFrame(frame);
      frame = undefined;
      treesDirty = false;
      pendingNodes.clear();
      nativeNodes.clear();
      for (const node of hiddenNodes) node.removeAttribute(hiddenAttribute);
      hiddenNodes.clear();
      for (const tree of trees.values()) tree.dispose();
      trees.clear();
    }

    async function applyVisibility(signal) {
      if (!appliedSections.size) {
        await forEachSlice([...hiddenNodes], node => setHidden(node, false), signal, true);
        signal.throwIfAborted();
        clearVisibility();
        return;
      }
      if (!observing) {
        observing = true;
        for (const scope of [root, drawer]) {
          if (!scope) continue;
          for (const node of scope.querySelectorAll(nativeSelector)) nativeNodes.add(node);
          observer.observe(scope, observedChanges);
        }
      }
      await forEachSlice([...nativeNodes], applyNodeVisibility, signal, true);
    }

    function updatePicker() {
      const names = sections.filter(({ key }) => selected.has(key)).map(({ label }) => label);
      picker.textContent = names.length === 1 ? `CODEOWNERS · ${names[0]}` : "CODEOWNERS";
      if (names.length > 1) picker.textContent += ` · ${names.length}`;
      picker.title = names.join(", ");
      reset.setAttribute("aria-pressed", String(!selected.size));
    }

    async function renderJump(signal) {
      if (!appliedSections.size || !visibleFiles.length) {
        jump.hidden = true;
        return;
      }
      if (jumpFiles === visibleFiles) {
        jump.hidden = false;
        return;
      }
      const destinationsFiles = visibleFiles;
      const destinations = document.createDocumentFragment();
      destinations.append(new Option("Перейти к файлу…", ""));
      const groups = new Map();
      await forEachSlice(destinationsFiles.entries(), ([index, file]) => {
        const slash = file.newPath.lastIndexOf("/");
        const folder = slash < 0 ? "/" : file.newPath.slice(0, slash);
        if (!groups.has(folder)) {
          const group = element("optgroup");
          group.label = folder;
          destinations.append(group);
          groups.set(folder, group);
        }
        const name = file.newPath.slice(slash + 1);
        groups.get(folder).append(new Option(name, String(index)));
      }, signal);
      signal.throwIfAborted();
      jump.replaceChildren(destinations);
      jumpFiles = destinationsFiles;
      jump.hidden = false;
    }

    async function renderSelection(signal) {
      await afterPaint();
      signal.throwIfAborted();
      appliedSections = new Set(selected);
      const nextFiles = appliedSections.size ? files.filter(matches) : files;
      if (visibleFiles.length !== nextFiles.length || nextFiles.some((file, index) => file !== visibleFiles[index])) {
        visibleFiles = nextFiles;
      }
      await applyVisibility(signal);
      signal.throwIfAborted();
      if (appliedSections.size) await syncTrees();
      signal.throwIfAborted();
      await renderJump(signal);
      signal.throwIfAborted();

      let message = "";
      if (appliedSections.size) {
        message = visibleFiles.length
          ? `Файлы · ${visibleFiles.length} из ${files.length}`
          : "Файлов в выбранных секциях нет.";
      }
      showStatus(message);
    }

    function requestFilter() {
      filterController?.abort();
      filterController = new AbortController();
      const signal = filterController.signal;
      updatePicker();
      showStatus("Применяем фильтр…", true);
      void renderSelection(signal).catch(error => {
        if (!signal.aborted) showStatus(error instanceof Error ? error.message : "Не удалось применить фильтр.");
      });
    }

    function saveSelection() {
      const values = [...selected];
      save = save.then(() => chrome.storage.local.set({ [storageKey]: values })).catch(() => {});
      requestFilter();
    }

    async function renderOptions(preference, signal) {
      const saved = Array.isArray(preference) ? preference : [];
      if (typeof preference === "string" && preference.startsWith("section:")) saved.push(preference.slice("section:".length));
      const counts = new Map();
      for (const { owners } of files) {
        for (const key of owners) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      reset.textContent = `Все файлы · ${files.length}`;
      const labels = document.createDocumentFragment();
      await forEachSlice(sections, ({ label, key }) => {
        const option = element("label", "option");
        const input = element("input");
        input.type = "checkbox";
        input.value = key;
        input.checked = saved.includes(key);
        if (input.checked) selected.add(key);
        option.append(input, element("span", "", `${label} · ${counts.get(key) ?? 0}`));
        labels.append(option);
      }, signal);
      signal.throwIfAborted();
      ready = true;
      if (sections.length) options.replaceChildren(optionsStatus, reset, labels);
      if (selected.size) requestFilter();
      else {
        updatePicker();
        showStatus(sections.length ? "" : "В целевой ветке нет правил CODEOWNERS.");
      }
    }

    async function load() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      ready = false;
      retry.hidden = true;
      showStatus("Загружаем CODEOWNERS…", true);
      try {
        const [rules, entries, stored] = await Promise.all([
          reviewData.loadSections(context, current.signal),
          reviewData.loadFiles(endpoint, current.signal),
          chrome.storage.local.get(storageKey).catch(() => ({})),
        ]);
        if (current.signal.aborted) return;
        sections = rules;
        files = [];
        await forEachSlice(entries, file => {
          files.push({ ...file, owners: reviewData.fileSections(file.oldPath, file.newPath, sections) });
        }, current.signal);
        filesByHash = new Map(files.filter(file => file.hash).map(file => [file.hash, file]));
        filesByPaths = new Map(files.map(file => [pathsKey(file), file]));
        await renderOptions(stored[storageKey], current.signal);
      } catch (error) {
        if (current.signal.aborted) return;
        showStatus(error instanceof Error ? error.message : "Не удалось загрузить CODEOWNERS.");
        retry.hidden = false;
      }
    }

    options.addEventListener("change", event => {
      const input = event.target;
      if (input.checked) selected.add(input.value);
      else selected.delete(input.value);
      saveSelection();
    });
    options.addEventListener("focusout", event => {
      const next = event.relatedTarget;
      if (next && next !== picker && !options.contains(next) && options.matches(":popover-open")) options.hidePopover();
    });
    reset.addEventListener("click", () => {
      if (!selected.size) return;
      selected.clear();
      for (const input of options.querySelectorAll("input:checked")) input.checked = false;
      saveSelection();
    });
    async function openFile(file, browser = root) {
      const card = file.hash && document.getElementById(file.hash);
      const selector = `:is(a, button)[data-file-row="${CSS.escape(file.hash ?? "")}"]`;
      const link = file.hash && browser.querySelector(selector);
      if (link && (card || root.querySelector(pagerSelector))) {
        link.click();
        return;
      }
      if (browser.closest(".diffs-tree-drawer")) document.querySelector('[data-testid="file-tree-drawer-button"]')?.click();
      if (card && root.contains(card)) {
        card.scrollIntoView({ block: "start" });
        return;
      }
      const url = fileUrl(file, rapid);
      await save;
      if (root.isConnected && !controller.signal.aborted) location.assign(url);
    }

    jump.addEventListener("change", () => {
      const file = jump.value && jumpFiles?.[Number(jump.value)];
      jump.value = "";
      if (file) void openFile(file);
    });
    retry.addEventListener("click", () => void load());
    void load();

    return {
      root,
      endpoint: endpoint.href,
      isConnected: () => root.isConnected && host.isConnected,
      dispose() {
        controller.abort();
        filterController?.abort();
        clearVisibility();
        host.remove();
      },
    };
  }

  const pageObserver = new MutationObserver(() => {
    if (!active?.isConnected()) update();
  });

  function update() {
    const context = reviewData.mergeRequestFromPath(location.pathname);
    if (!context || !/\/diffs\/?$/.test(location.pathname)) {
      pageObserver.disconnect();
      active?.dispose();
      active = undefined;
      return;
    }
    pageObserver.observe(document.body, { childList: true, subtree: true });
    const rapid = document.querySelector(".merge-request [data-rapid-diffs]");
    const root = rapid ?? document.querySelector(".merge-request #diffs.tab-pane");
    const endpoint = root && metadataUrl(context, root, Boolean(rapid));
    if (active?.root === root && active.endpoint === endpoint?.href && active.isConnected()) return;
    active?.dispose();
    active = root ? mount(context, root, Boolean(rapid), endpoint) : undefined;
  }

  update();
  if (window.navigation) window.navigation.addEventListener("currententrychange", update);
  else window.addEventListener("popstate", update);
})();
