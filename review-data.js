const reviewData = (() => {
  const codeownersPaths = ["CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"];
  const gitEscapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

  function mergeRequestFromPath(pathname) {
    const match = pathname.match(/^\/(.+?)\/-\/merge_requests\/([1-9]\d*)(?:\/|$)/);
    if (!match) return null;
    try {
      return { project: decodeURIComponent(match[1]), iid: match[2] };
    } catch {
      return null;
    }
  }

  function normalizePattern(pattern) {
    if (pattern === "*") return "/**/*";
    pattern = pattern.replace(/^\\#/, "#").replace(/\\\s+/g, " ");
    if (!pattern.startsWith("/")) pattern = `/**/${pattern}`;
    if (pattern.endsWith("/")) pattern += "**/*";
    return pattern;
  }

  function escapeRegex(character) {
    return character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }

  function globRegex(pattern) {
    let regex = "^";
    for (let index = 0; index < pattern.length; index++) {
      const character = pattern[index];
      if (character === "\\" && index + 1 < pattern.length) {
        regex += escapeRegex(pattern[++index]);
      } else if ((index === 0 || pattern[index - 1] === "/") && pattern.startsWith("**/", index)) {
        regex += "(?:[^/]+/)*";
        index += 2;
      } else if (character === "*") {
        regex += "[^/]*";
        while (pattern[index + 1] === "*") index++;
      } else if (character === "?") {
        regex += "[^/]";
      } else if (character === "[") {
        const group = pattern.slice(index).match(/^\[([!^]?(?:\]|[^\]])(?:\\.|[^\]])*)\]/);
        if (!group) return null;
        const members = group[1].replace(/^!/, "^").replace(/(?<!\\)\[/g, "\\[");
        regex += `(?!/)[${members}]`;
        index += group[0].length - 1;
      } else {
        regex += escapeRegex(character);
      }
    }
    try {
      return new RegExp(`${regex}(?![\\s\\S])`, "u");
    } catch {
      return null;
    }
  }

  function parseCodeowners(contents) {
    const sections = new Map();
    let key = "";
    let label = "Без секции";

    for (const source of contents.split("\n")) {
      const line = source.trim();
      if (!line || line.startsWith("#")) continue;
      const header = line.match(/^\^?\[([^\]]+)\](?:\[\d+\])?(?:\s|$)/);
      if (header) {
        label = header[1].trim();
        key = label.toLowerCase();
        continue;
      }

      const token = line.match(/^(?:\\.|[^\s\\])+/)?.[0];
      if (!token || token === "!") continue;
      const excluded = token.startsWith("!");
      const pattern = normalizePattern(excluded ? token.slice(1) : token);
      const match = globRegex(pattern);
      if (!match) continue;
      if (!sections.has(key)) sections.set(key, { key, label, rules: new Map() });
      sections.get(key).rules.set(pattern, { match, excluded });
    }
    return [...sections.values()];
  }

  function matchesPath(section, path) {
    let matched = false;
    for (const { match, excluded } of section.rules.values()) {
      if (!match.test(`/${path}`)) continue;
      if (excluded) return false;
      matched = true;
    }
    return matched;
  }

  function assignSections(files, sections) {
    for (const file of files) {
      const paths = file.oldPath === file.newPath ? [file.path] : [file.oldPath, file.newPath];
      file.sections = sections.filter(section => paths.some(path => matchesPath(section, path)));
    }
  }

  function decodeGitPath(path) {
    if (!path.startsWith('"')) return path;
    const bytes = [];
    const chunks = path.slice(1, -1).matchAll(/\\([0-7]{3}|.)|[^\\]+/gs);
    for (const [chunk, escape] of chunks) {
      if (escape === undefined) {
        for (const byte of encoder.encode(chunk)) bytes.push(byte);
      } else {
        bytes.push(gitEscapes[escape] ?? Number.parseInt(escape, 8));
      }
    }
    return decoder.decode(Uint8Array.from(bytes));
  }

  function fileFromPatch(header, lines) {
    let oldPath;
    let newPath;
    let status = "M";
    let binary = false;
    let changes = [];

    for (const [index, line] of lines.entries()) {
      if (line.startsWith("@@ ")) {
        changes = changes.concat(lines.slice(index));
        break;
      }
      if (line.startsWith("new file mode ")) status = "A";
      if (line.startsWith("deleted file mode ")) status = "D";
      if (line.startsWith("old mode ") || line.startsWith("new mode ")) changes.push(line);
      const move = line.match(/^(rename|copy) (from|to) (.+)$/);
      if (move) {
        status = move[1] === "rename" ? "R" : "C";
        if (move[2] === "from") oldPath = decodeGitPath(move[3]);
        else newPath = decodeGitPath(move[3]);
      }
      if (line === "GIT binary patch" || line.startsWith("Binary files ")) {
        binary = true;
        break;
      }
    }

    if (!oldPath || !newPath) {
      // For files that were not moved, both paths in the header are identical.
      const samePath = header.match(/^a\/(.*) b\/\1$/) ?? header.match(/^"a\/(.*)" "b\/\1"$/);
      if (!samePath) throw new Error("Не удалось разобрать путь файла в diff GitLab.");
      oldPath = newPath = header.startsWith('"') ? decodeGitPath(`"${samePath[1]}"`) : samePath[1];
    }

    return { oldPath, newPath, path: status === "D" ? oldPath : newPath, status, binary, changes };
  }

  function parseRawDiff(patch) {
    if (!patch.trim()) return [];
    const records = patch.split(/(?=^diff --git )/m);
    if (!records[0].startsWith("diff --git ")) throw new Error("GitLab вернул ответ в неизвестном формате diff.");
    return records.map(record => {
      const lines = record.split("\n");
      if (lines.at(-1) === "") lines.pop();
      const header = lines.shift().slice("diff --git ".length);
      return fileFromPatch(header, lines);
    });
  }

  async function request(path, signal, { allowMissing = false } = {}) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
    if ([401, 403].includes(response.status) || response.redirected) {
      throw new Error("Войдите в GitLab и проверьте доступ к МР.");
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitLab вернул HTTP ${response.status}.`);
    return response;
  }

  async function loadCodeowners(project, branch, signal) {
    for (const path of codeownersPaths) {
      const url = `${project}/repository/files/${encodeURIComponent(path)}/raw?${new URLSearchParams({ ref: branch })}`;
      const response = await request(url, signal, { allowMissing: true });
      if (response) return parseCodeowners(await response.text());
    }
    return [];
  }

  async function loadReview(context, signal) {
    const project = `/api/v4/projects/${encodeURIComponent(context.project)}`;
    const endpoint = `${project}/merge_requests/${context.iid}`;
    const mr = await (await request(endpoint, signal)).json();
    const [patch, sections] = await Promise.all([
      request(`${endpoint}/raw_diffs`, signal).then(response => response.text()),
      loadCodeowners(project, mr.target_branch, signal),
    ]);

    const files = parseRawDiff(patch);
    assignSections(files, sections);
    const expected = String(mr.changes_count ?? "");
    const incomplete = (/^\d+$/.test(expected) && files.length !== Number(expected))
      || (/^\d+\+$/.test(expected) && files.length <= Number.parseInt(expected, 10));
    return { files, sections, incomplete, expected, targetBranch: mr.target_branch };
  }

  return { mergeRequestFromPath, parseCodeowners, assignSections, parseRawDiff, loadReview };
})();
