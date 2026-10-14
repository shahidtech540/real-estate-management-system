"use client";

// Cookies remain the normal session transport. Embedded browsers may block them,
// so retain only the short-lived access token in this tab (never a refresh token).
const TOKEN_KEY = "rems_access_token";
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || accessToken;
  } catch {
    return accessToken;
  }
}

export function setAccessToken(token: string): void {
  accessToken = token;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* Private/embedded storage may be disabled. In-memory SPA navigation still works. */
  }
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Remove the legacy persistent copy when permitted. */
  }
}

export function clearAccessToken(): void {
  accessToken = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Storage unavailable. */
  }
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Storage unavailable. */
  }
}

const TOKEN_ENDPOINTS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/context",
  "/api/v1/auth/refresh",
]);

export async function authFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  // Never send bearer credentials to external URLs or public asset hosts.
  if (!path.startsWith("/api/v1/")) return fetch(path, init);
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token && !headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers,
  });
  if (response.ok && TOKEN_ENDPOINTS.has(path)) {
    const data = await response.clone().json();
    if (typeof data.accessToken === "string" && data.accessToken)
      setAccessToken(data.accessToken);
  }
  if (response.ok && path === "/api/v1/auth/logout") clearAccessToken();
  // Do not let an older in-flight request clear a newly switched session.
  if (
    response.status === 401 &&
    path !== "/api/v1/auth/login" &&
    token === getAccessToken()
  )
    clearAccessToken();
  return response;
}
