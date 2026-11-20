(() => {
  const filters = new WeakMap();

  function classicApp(root) {
    for (let node = root; node && !node.matches(".merge-request"); node = node.parentElement) {
      const app = node.__vue__;
      if (app?.$options?.name === "DiffsApp") return app;
    }
    return null;
  }

  document.addEventListener("raketa-codeowners-filter-classic", event => {
    const root = event.target;
    if (!(root instanceof Element) || !root.matches(".merge-request :is(#diffs, #js-diffs-app)")) return;
    if (!Array.isArray(event.detail)) return;

    const app = classicApp(root);
    if (!app) return;
    const { diffs, diffFiles, hasChanges, diffsIncomplete } = app._computedWatchers ?? {};
    const watchers = [diffFiles, hasChanges, diffsIncomplete];
    if ([diffs, ...watchers].some(watcher => typeof watcher?.getter !== "function")) return;

    const refresh = () => {
      for (const watcher of watchers) watcher.dirty = true;
      diffs.dirty = true;
      app.$forceUpdate();
    };

    let filter = filters.get(root);
    if (!filter) {
      filter = { hashes: new Set(), paths: new Set() };
      filters.set(root, filter);
      const originalGetters = watchers.map(watcher => watcher.getter);
      const readFiles = diffFiles.getter;

      // Filter before Vue builds the virtual list. GitLab's file jumps use its indices.
      diffFiles.getter = function () {
        return readFiles.call(this, this).filter(file =>
          filter.hashes.has(file.file_hash) || filter.paths.has(file.new_path));
      };
      hasChanges.getter = function () {
        return readFiles.call(this, this).length > 0;
      };
      diffsIncomplete.getter = function () {
        return this.flatBlobsList.length !== readFiles.call(this, this).length;
      };

      root.addEventListener("raketa-codeowners-reset-classic", () => {
        watchers.forEach((watcher, index) => { watcher.getter = originalGetters[index]; });
        filters.delete(root);
        refresh();
      }, { once: true });
    }

    filter.hashes.clear();
    filter.paths.clear();
    for (const { hash, newPath } of event.detail) {
      if (hash) filter.hashes.add(hash);
      else filter.paths.add(newPath);
    }
    refresh();
    event.preventDefault();
  });
})();
