import { useState, useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

  // Track whether the initial Convex auth check has completed.
  // useConvexAuth can briefly report isLoading=false before the token has
  // fully propagated through the query layer. This flag ensures we don't
  // treat that transitional state as "auth settled".
  const [authInitialized, setAuthInitialized] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (!isAuthLoading && !initRef.current) {
      initRef.current = true;
      setAuthInitialized(true);
    }
  }, [isAuthLoading]);

  // Auth is loading until ALL of:
  //   1. useConvexAuth finishes its initial session check
  //   2. The user query has resolved (undefined → null | user)
  //   3. The initialized flag has been set (one tick after isAuthLoading flips)
  const isLoading = isAuthLoading || user === undefined || !authInitialized;

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
