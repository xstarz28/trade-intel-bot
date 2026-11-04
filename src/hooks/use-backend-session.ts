import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBackendSession,
  logoutBackendSession,
  type BackendUser,
} from "@/lib/backend-api";

export type BackendAuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: BackendUser }
  | { status: "error"; error: Error };

/**
 * Reads and manages an existing self-hosted backend session.
 *
 * This hook deliberately never creates a guest account. Session creation and
 * provider migration must be explicit so a Convex user is not silently assigned
 * a different backend identity.
 */
export function useBackendSession() {
  const [state, setState] = useState<BackendAuthState>({ status: "loading" });
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setState({ status: "loading" });
    try {
      const session = await getBackendSession();
      if (requestVersion.current !== version) return;
      setState(session.user
        ? { status: "authenticated", user: session.user }
        : { status: "anonymous" });
    } catch (cause) {
      if (requestVersion.current !== version) return;
      setState({
        status: "error",
        error: cause instanceof Error ? cause : new Error("Unable to read backend session"),
      });
    }
  }, []);

  const logout = useCallback(async () => {
    const version = ++requestVersion.current;
    await logoutBackendSession();
    if (requestVersion.current === version) setState({ status: "anonymous" });
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestVersion.current += 1;
    };
  }, [refresh]);

  return { state, refresh, logout };
}
