const AUTH_REDIRECT_ORIGIN = "https://xstarz-auth.invalid";

function isSafeInternalPath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) return false;

  try {
    return new URL(value, AUTH_REDIRECT_ORIGIN).origin === AUTH_REDIRECT_ORIGIN;
  } catch {
    return false;
  }
}

export function resolveAuthRedirect(
  returnTo: string | null,
  fallback = "/dashboard",
): string {
  const safeFallback = isSafeInternalPath(fallback) ? fallback : "/dashboard";
  if (!returnTo || !isSafeInternalPath(returnTo)) return safeFallback;

  const target = new URL(returnTo, AUTH_REDIRECT_ORIGIN);
  return `${target.pathname}${target.search}${target.hash}`;
}
