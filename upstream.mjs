// Upstream API used by the AniLab Android app (com.xo.anilab 1.0.5).
// Base URL and headers recovered from the app's OkHttp interceptor (e1.b) and Retrofit setup (e1.a).
export const UPSTREAM_BASE = "https://anilab2.amdapi.click/api/";

export const UPSTREAM_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "os-version": "34",
  "app-id": "com.xo.anilab",
  "app-version": "105",
  // The app sends its OneSignal device id here; the web client has none.
  "os-id": "",
};

// Only the endpoints declared in the app's API interface (e1.c) are proxied.
export const ALLOWED_ENDPOINTS = new Set(["home", "config", "categories", "category", "latest", "post", "search", "list"]);

// My List is requested as GET /api/list?page=N&ids=1,2,3 (Android's WebView can't read POST bodies
// of intercepted requests); the upstream wants POST list?page=N with {"ids":[...]}.
export function listAsPost(searchParams) {
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return { search: `?page=${encodeURIComponent(searchParams.get("page") ?? "1")}`, body: JSON.stringify({ ids }) };
}
