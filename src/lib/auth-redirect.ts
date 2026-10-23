const AUTH_REDIRECT_ORIGIN = "https://xstarz-auth.invalid";

export function resolveAuthRedirect(
  returnTo: string | null,
  fallback = "/dashboard",
): string {
  if (
    !returnTo ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(returnTo)
  ) {
    return fallback;
  }

  try {
    const target = new URL(returnTo, AUTH_REDIRECT_ORIGIN);
    if (target.origin !== AUTH_REDIRECT_ORIGIN) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
