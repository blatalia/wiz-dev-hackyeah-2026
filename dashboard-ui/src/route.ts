import { useCallback, useEffect, useState } from "react";

export const VIEW_IDS = ["overview", "events", "config"] as const;
export type View = (typeof VIEW_IDS)[number];
export type Params = Record<string, string | undefined>;
export type Route = { view: View; params: Record<string, string> };

function parse(): Route {
  const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  const view = (VIEW_IDS as readonly string[]).includes(path) ? (path as View) : "overview";
  return { view, params: Object.fromEntries(new URLSearchParams(query)) };
}

export function href(view: View, params: Params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) query.set(k, v);
  }
  const q = query.toString();
  return `#/${view}${q ? `?${q}` : ""}`;
}

export function useRoute() {
  const [route, setRoute] = useState(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const go = useCallback((view: View, params: Params = {}) => {
    window.location.hash = href(view, params);
  }, []);

  return [route, go] as const;
}
