function parseOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" && url.pathname !== "") return null;
    if (url.protocol === "chrome-extension:") {
      return /^[a-p]{32}$/.test(url.hostname) && !url.port ? url : null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function originMatchesRule(origin, rule) {
  const candidate = parseOrigin(origin);
  if (!candidate) return false;
  if (rule === "*") return true;
  if (rule === "chrome-extension://*") return candidate.protocol === "chrome-extension:";
  const subdomains = rule.includes("://*.");
  // Legacy trailing '*' rules are restricted to their exact origin. A host
  // prefix must never grant access to arbitrary unrelated domains.
  const normalizedRule = subdomains ? rule.replace("://*.", "://") : rule.replace(/\*$/, "");
  const allowed = parseOrigin(normalizedRule);
  if (!allowed || candidate.protocol !== allowed.protocol || candidate.port !== allowed.port) return false;
  return subdomains
    ? candidate.hostname.endsWith(`.${allowed.hostname}`)
    : candidate.hostname === allowed.hostname;
}
