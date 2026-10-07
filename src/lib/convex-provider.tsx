import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
// @ts-expect-error aliased internal export
import { ConvexAuthActionsContext } from "@convex-dev/auth-internal/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { discoverOkxInstruments as discoverOkxInstrumentsPure } from "@/lib/data/universal/okx-discovery";

const STORAGE_KEY_ANALYSES = "xstarz_mock_analyses";
const STORAGE_KEY_POSITIONS = "xstarz_mock_positions";
const STORAGE_KEY_ALERTS = "xstarz_mock_alerts";
const STORAGE_KEY_AUTH = "xstarz_mock_auth_user";

export interface MockAuthUser {
  _id: string;
  name: string;
  email?: string;
  isAnonymous?: boolean;
}

const DEFAULT_USER: MockAuthUser = {
  _id: "user_analyst",
  name: "Guest Trader",
  email: "trader@xstarz.local",
  isAnonymous: true,
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const listeners = new Set<() => void>();
function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.warn("[MockConvex] Listener update failed:", e);
    }
  });
}

function resolveMockQuery(functionName: string, args?: Record<string, unknown>): unknown {
  switch (functionName) {
    case "users:currentUser": {
      return readStorage<MockAuthUser | null>(STORAGE_KEY_AUTH, DEFAULT_USER);
    }
    case "analyses:list": {
      const all = readStorage<any[]>(STORAGE_KEY_ANALYSES, []);
      const limit = typeof args?.limit === "number" ? args.limit : 50;
      return all.slice(0, limit);
    }
    case "positionProtection:listActivePositions": {
      return readStorage<any[]>(STORAGE_KEY_POSITIONS, []);
    }
    case "notificationPreferences:getPreferences": {
      return { inApp: true, email: false, sound: true, minSeverity: "WATCH" };
    }
    case "notifications:list": {
      return readStorage<any[]>(STORAGE_KEY_ALERTS, []);
    }
    case "alertRules:listRules": {
      return [];
    }
    case "runtimeHealth:getHealthStatus": {
      return { status: "healthy", uptime: 100, lastChecked: Date.now() };
    }
    default: {
      return [];
    }
  }
}

async function resolveMockMutation(
  functionName: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const id = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  switch (functionName) {
    case "analyses:save": {
      const current = readStorage<any[]>(STORAGE_KEY_ANALYSES, []);
      const newRecord = {
        _id: id,
        _creationTime: Date.now(),
        timestamp: Date.now(),
        ...args,
      };
      const updated = [newRecord, ...current].slice(0, 100);
      writeStorage(STORAGE_KEY_ANALYSES, updated);
      notifyListeners();
      return id;
    }
    case "analyses:clear": {
      writeStorage(STORAGE_KEY_ANALYSES, []);
      notifyListeners();
      return { success: true };
    }
    case "positionProtection:savePosition": {
      const positions = readStorage<any[]>(STORAGE_KEY_POSITIONS, []);
      const existingIdx = positions.findIndex((p) => p.positionId === args?.positionId);
      const newPos = { _id: id, ...args, updatedAt: Date.now() };
      if (existingIdx >= 0) {
        positions[existingIdx] = newPos;
      } else {
        positions.push(newPos);
      }
      writeStorage(STORAGE_KEY_POSITIONS, positions);
      notifyListeners();
      return id;
    }
    case "positionProtection:deletePosition": {
      const positions = readStorage<any[]>(STORAGE_KEY_POSITIONS, []);
      const updated = positions.filter((p) => p.positionId !== args?.positionId);
      writeStorage(STORAGE_KEY_POSITIONS, updated);
      notifyListeners();
      return { success: true };
    }
    case "positionProtection:saveAlert":
    case "positionProtection:acknowledgeAlert": {
      const alerts = readStorage<any[]>(STORAGE_KEY_ALERTS, []);
      alerts.push({ _id: id, ...args, timestamp: Date.now() });
      writeStorage(STORAGE_KEY_ALERTS, alerts.slice(0, 50));
      notifyListeners();
      return id;
    }
    default: {
      notifyListeners();
      return id;
    }
  }
}

async function resolveMockAction(
  functionName: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  switch (functionName) {
    case "okx:discoverOkxInstruments": {
      try {
        const result = await discoverOkxInstrumentsPure((url: string) =>
          fetch(url, { headers: { Accept: "application/json" } }),
        );
        if (result && result.instruments && result.instruments.length > 0) {
          return result;
        }
      } catch (err) {
        console.warn("[MockConvex] Pure discovery fallback triggered:", err);
      }
      return {
        success: true,
        provider: "okx",
        discoveredAt: Date.now(),
        instruments: [
          { instId: "BTC-USDT-SWAP", instType: "SWAP", baseAsset: "BTC", quoteAsset: "USDT", subType: "crypto_perpetual" },
          { instId: "ETH-USDT-SWAP", instType: "SWAP", baseAsset: "ETH", quoteAsset: "USDT", subType: "crypto_perpetual" },
          { instId: "SOL-USDT-SWAP", instType: "SWAP", baseAsset: "SOL", quoteAsset: "USDT", subType: "crypto_perpetual" },
          { instId: "XRP-USDT-SWAP", instType: "SWAP", baseAsset: "XRP", quoteAsset: "USDT", subType: "crypto_perpetual" },
          { instId: "DOGE-USDT-SWAP", instType: "SWAP", baseAsset: "DOGE", quoteAsset: "USDT", subType: "crypto_perpetual" },
        ],
        warnings: [],
      };
    }
    case "okx:acquireOkxNativeLiveDataBatch": {
      try {
        const { acquireBatchProviderNativeLiveData } = await import(
          "@/lib/market-radar/provider-registry"
        );
        const instruments = ((args?.instruments as any[]) || []).map((input) => ({
          ...input,
          provider: "okx",
          assetClass: input.assetClass ?? "crypto",
        }));
        const concurrency = typeof args?.concurrency === "number" ? args.concurrency : 5;
        return await acquireBatchProviderNativeLiveData(instruments, undefined, concurrency);
      } catch {
        return [];
      }
    }
    default: {
      return { success: true };
    }
  }
}

function createMockConvexClient() {
  return {
    address: "https://mock.xstarz.local",
    options: { verbose: false },
    watchQuery(query: FunctionReference<any> | string, ...argsAndOptions: any[]) {
      const args = argsAndOptions[0];
      const fnName = typeof query === "string" ? query : getFunctionName(query);
      return {
        onUpdate(callback: () => void) {
          listeners.add(callback);
          return () => {
            listeners.delete(callback);
          };
        },
        localQueryResult() {
          return resolveMockQuery(fnName, args);
        },
        localQueryLogs() {
          return undefined;
        },
      };
    },
    async mutation(mutationReference: FunctionReference<any> | string, ...args: any[]) {
      const fnName =
        typeof mutationReference === "string"
          ? mutationReference
          : getFunctionName(mutationReference);
      return resolveMockMutation(fnName, args[0]);
    },
    async action(actionReference: FunctionReference<any> | string, ...args: any[]) {
      const fnName =
        typeof actionReference === "string"
          ? actionReference
          : getFunctionName(actionReference);
      return resolveMockAction(fnName, args[0]);
    },
    connectionState() {
      return {
        hasInflightRequests: false,
        isWebSocketConnected: true,
        hasEverConnected: true,
        connectionCount: 1,
        connectionRetries: 0,
        timeOfOldestInflightRequest: null,
        inflightMutations: 0,
        inflightActions: 0,
      };
    },
    setAuth() {
      return Promise.resolve();
    },
    clearAuth() {},
    close() {},
  } as unknown as ConvexReactClient;
}

const mockClient = createMockConvexClient();

function MockConvexAuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<MockAuthUser | null>(() =>
    readStorage<MockAuthUser | null>(STORAGE_KEY_AUTH, DEFAULT_USER),
  );

  const authActions = useMemo(
    () => ({
      signIn: async (provider: string) => {
        const user: MockAuthUser = {
          _id: "user_" + Date.now(),
          name: provider === "google" ? "Google Trader" : "Guest Trader",
          email: provider === "google" ? "trader@gmail.com" : "trader@xstarz.local",
          isAnonymous: provider === "anonymous",
        };
        writeStorage(STORAGE_KEY_AUTH, user);
        setCurrentUser(user);
        notifyListeners();
      },
      signOut: async () => {
        writeStorage(STORAGE_KEY_AUTH, null);
        setCurrentUser(null);
        notifyListeners();
      },
    }),
    [],
  );

  const useAuthBridge = useCallback(
    () => ({
      isLoading: false,
      isAuthenticated: currentUser !== null,
      fetchAccessToken: async () => (currentUser ? "mock-access-token" : null),
    }),
    [currentUser],
  );

  return (
    <ConvexAuthActionsContext.Provider value={authActions}>
      <ConvexProviderWithAuth client={mockClient} useAuth={useAuthBridge}>
        {children}
      </ConvexProviderWithAuth>
    </ConvexAuthActionsContext.Provider>
  );
}

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  const rawUrl = import.meta.env.VITE_CONVEX_URL;
  const isConvexConfigured = Boolean(
    rawUrl &&
      typeof rawUrl === "string" &&
      rawUrl.trim().length > 0 &&
      rawUrl.trim().startsWith("http") &&
      !rawUrl.includes("placeholder") &&
      !rawUrl.includes("dummy"),
  );

  const realConvex = useMemo(() => {
    if (!isConvexConfigured) return null;
    try {
      return new ConvexReactClient(rawUrl!);
    } catch (e) {
      console.warn("[AppAuthProvider] Could not connect to configured Convex URL:", e);
      return null;
    }
  }, [isConvexConfigured, rawUrl]);

  if (realConvex) {
    return <ConvexAuthProvider client={realConvex}>{children}</ConvexAuthProvider>;
  }

  return <MockConvexAuthProvider>{children}</MockConvexAuthProvider>;
}
