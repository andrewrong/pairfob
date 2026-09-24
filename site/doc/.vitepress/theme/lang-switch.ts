// Docs language switch shared by the navbar (ChromeLinks.vue) and the phone
// menu (ScreenLinks.vue). lang.js owns the preference and the path mapping.
export function switchDocsLanguage(next: "zh" | "en"): void {
  const api = (window as unknown as { PairfobLang?: {
    set: (lang: string) => string;
    docPath: (path: string, lang: string) => string;
    samePath: (a: string, b: string) => boolean;
  } }).PairfobLang;
  if (api) {
    api.set(next);
    const target = api.docPath(location.pathname, next);
    if (!api.samePath(target, location.pathname)) {
      location.assign(target + location.search + location.hash);
    }
    return;
  }
  // Fallback when lang.js has not loaded. English is the root locale.
  const path = location.pathname;
  const rest = path.startsWith("/doc") ? path.slice(4) || "/" : "/";
  const body = rest === "/zh" || rest.startsWith("/zh/") ? rest.slice(3) || "/" : rest;
  location.assign(next === "zh" ? (body === "/" ? "/doc/zh/" : "/doc/zh" + body) : body === "/" ? "/doc/" : "/doc" + body);
}
