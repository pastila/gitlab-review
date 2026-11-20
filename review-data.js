const reviewData = (() => {
  const codeownersPaths = ["CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"];

  function mergeRequestFromPath(pathname) {
    const match = pathname.match(/^\/(.+?)\/-\/merge_requests\/([1-9]\d*)(?:\/|$)/);
    if (!match) return null;
    try {
      return { project: decodeURIComponent(match[1]), iid: match[2] };
    } catch {
      return null;
    }
  }

  function mergeRequestPath(context) {
    const project = context.project.split("/").map(encodeURIComponent).join("/");
    return `/${project}/-/merge_requests/${context.iid}`;
  }

  function projectApiPath(context) {
    return `/api/v4/projects/${encodeURIComponent(context.project)}`;
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

  function fileSections(oldPath, newPath, sections) {
    const paths = oldPath === newPath ? [newPath] : [oldPath, newPath];
    return sections.filter(section => paths.some(path => matchesPath(section, path))).map(section => section.key);
  }

  async function request(path, signal, { allowMissing = false } = {}) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
    if (allowMissing && response.status === 404 && !response.redirected) return null;
    if ([401, 403].includes(response.status) || response.redirected) {
      throw new Error("Войдите в GitLab и проверьте доступ к МР.");
    }
    if (!response.ok) throw new Error(`GitLab вернул HTTP ${response.status}.`);
    return response;
  }

  async function loadSections(context, signal) {
    const project = projectApiPath(context);
    const endpoint = `${project}/merge_requests/${context.iid}`;
    const { target_branch: branch } = await (await request(endpoint, signal)).json();
    for (const path of codeownersPaths) {
      const url = `${project}/repository/files/${encodeURIComponent(path)}/raw?${new URLSearchParams({ ref: branch })}`;
      const response = await request(url, signal, { allowMissing: true });
      if (response) return parseCodeowners(await response.text());
    }
    return [];
  }

  function approvalStatus(rules) {
    const required = rules.filter(rule => rule.approvals_required > 0);
    if (required.some(rule => rule.approved === false)) return "pending";
    if (required.some(rule => rule.approved !== true)) return "unavailable";
    if (required.length) {
      const missingVotes = required.some(rule => Array.isArray(rule.approved_by)
        && rule.approved_by.length < rule.approvals_required);
      return missingVotes ? "satisfied" : "approved";
    }
    return rules.every(rule => Array.isArray(rule.approved_by) && rule.approved_by.length > 0)
      ? "approved" : "optional";
  }

  async function loadApprovals(context, signal) {
    const endpoint = `${projectApiPath(context)}/merge_requests/${context.iid}/approval_state`;
    const { rules } = await (await request(endpoint, signal)).json();
    if (!Array.isArray(rules)) throw new Error("GitLab не вернул правила апрува.");

    const bySection = new Map();
    for (const rule of rules) {
      if (rule?.rule_type !== "code_owner" || typeof rule.section !== "string") continue;
      const key = rule.section.trim().toLowerCase();
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key).push(rule);
    }
    const approvals = new Map();
    for (const [key, entries] of bySection) approvals.set(key, approvalStatus(entries));
    // GitLab calls the unnamed CODEOWNERS section "codeowners".
    if (approvals.has("codeowners")) approvals.set("", approvals.get("codeowners"));
    return approvals;
  }

  async function loadFiles(endpoint, signal) {
    const { diff_files: files } = await (await request(endpoint, signal)).json();
    if (!Array.isArray(files)) throw new Error("GitLab не вернул список файлов.");
    return files.map(file => ({
      oldPath: file.old_path,
      newPath: file.new_path,
      hash: file.file_hash,
    })).filter(file => typeof file.oldPath === "string" && typeof file.newPath === "string");
  }

  return { mergeRequestFromPath, mergeRequestPath, fileSections, loadSections, loadFiles, loadApprovals };
})();
