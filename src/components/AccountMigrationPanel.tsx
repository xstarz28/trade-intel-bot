import { useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useBackendSession } from "@/hooks/use-backend-session";
import {
  BackendApiError,
  getBackendGoogleSignInUrl,
  importBackendAccount,
  type ConvexAccountExport,
} from "@/lib/backend-api";
import { ArrowRightLeft, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

export function AccountMigrationPanel() {
  const convex = useConvex();
  const { isAuthenticated: legacyAuthenticated, isLoading: legacyAuthLoading } = useConvexAuth();
  const { signIn: signInLegacy } = useAuthActions();
  const { state: backendState, refresh } = useBackendSession();
  const [busy, setBusy] = useState(false);
  const [legacyAuthBusy, setLegacyAuthBusy] = useState(false);
  const [legacyAuthError, setLegacyAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    totalSource: number;
    totalInserted: number;
    totalSkipped: number;
    reconciled: boolean;
    sourceCounts: Record<string, number>;
    inserted: Record<string, number>;
    skipped: Record<string, number>;
  } | null>(null);

  if (backendState.status === "error" && backendState.error instanceof BackendApiError && backendState.error.status === 404) {
    return null;
  }

  const handleLegacySignIn = async () => {
    setLegacyAuthError(null);
    setLegacyAuthBusy(true);
    try {
      await signInLegacy("google", {
        redirectTo: `${window.location.origin}/dashboard`,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "legacy_google_sign_in_failed";
      setLegacyAuthError(
        detail.toLowerCase().includes("redirect")
          ? "Login akun lama ditolak konfigurasi redirect Convex. Domain xstarzganaliys.com harus diizinkan pada deployment lama."
          : "Login akun Convex lama gagal. Pastikan Google OAuth pada deployment lama masih aktif.",
      );
      setLegacyAuthBusy(false);
    }
  };

  const handleMigration = async () => {
    setError(null);
    if (backendState.status !== "authenticated") {
      window.location.assign(getBackendGoogleSignInUrl());
      return;
    }
    if (!legacyAuthenticated) {
      setError("Hubungkan akun Convex lama terlebih dahulu dengan Google yang sama sebelum memulai ekspor.");
      return;
    }

    setBusy(true);
    try {
      const exported = await convex.query(
        api.accountMigration.exportMyAccount,
        {},
      ) as ConvexAccountExport;
      const payload: ConvexAccountExport = {
        ...exported,
        // Clicking this action is explicit confirmation for an email-less
        // Convex guest. Email-bearing accounts are still matched server-side.
        ...(!exported.account.email
          ? { confirmSourceAccountId: exported.account.id }
          : {}),
      };
      const imported = await importBackendAccount(payload);
      setResult(imported);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "account_migration_failed";
      const messages: Record<string, string> = {
        convex_account_identity_mismatch:
          "Email akun Convex dan backend berbeda. Masuk ke backend dengan Google yang sama dengan akun Convex.",
        convex_source_account_confirmation_required:
          "Konfirmasi akun tamu tidak valid. Muat ulang dashboard lalu ulangi migrasi.",
        authentication_required:
          "Sesi backend tidak ditemukan. Hubungkan akun backend terlebih dahulu.",
        unsupported_account_export:
          "Format ekspor Convex tidak dikenali. Pastikan versi aplikasi dan backend berasal dari rilis yang sama.",
        account_import_record_conflict:
          "Ada record dengan ID atau kunci yang sama tetapi isi/kepemilikannya berbeda. Seluruh transaksi migrasi dibatalkan; periksa data target sebelum mencoba lagi.",
      };
      setError(messages[code] ?? `Migrasi gagal: ${code}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="size-4 text-primary" />
          <CardTitle className="text-sm">Migrasi ke backend mandiri</CardTitle>
        </div>
        <CardDescription>
          Pindahkan data akun lama dari Convex ke database mandiri Trade Intel. Login, sesi, analisis baru, jurnal, dan fitur aplikasi berjalan melalui backend mandiri.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {backendState.status === "loading" ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Memeriksa sesi backend...
          </div>
        ) : backendState.status === "error" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-destructive">Sesi backend tidak dapat diperiksa.</p>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              <RefreshCw className="mr-1.5 size-3" /> Coba lagi
            </Button>
          </div>
        ) : backendState.status === "authenticated" ? (
          <p className="text-xs text-muted-foreground">
            Backend terhubung sebagai <span className="font-medium text-foreground">{backendState.user.email ?? "akun tamu"}</span>.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Hubungkan sesi backend dengan Google. Gunakan akun Google yang sama agar identitas dapat dicocokkan dengan aman.
          </p>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {legacyAuthLoading ? (
              <p className="text-xs text-muted-foreground">Memeriksa sesi akun Convex lama...</p>
            ) : legacyAuthenticated ? (
              <p className="text-xs text-muted-foreground">Akun Convex lama terhubung.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Akun Convex lama belum terhubung.</p>
            )}
            {backendState.status === "authenticated" ? (
              <p className="text-xs text-muted-foreground">
                Backend: <span className="font-medium text-foreground">{backendState.user.email ?? "akun tamu"}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {backendState.status !== "authenticated" && (
              <Button
                size="sm"
                className="w-full sm:w-auto"
                disabled={busy || backendState.status === "loading" || backendState.status === "error"}
                onClick={() => window.location.assign(getBackendGoogleSignInUrl())}
              >
                <ShieldCheck className="mr-2 size-3.5" />
                Hubungkan akun backend
              </Button>
            )}
            {backendState.status === "authenticated" && backendState.user.isAnonymous && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => window.location.assign(getBackendGoogleSignInUrl())}
              >
                Hubungkan Google backend
              </Button>
            )}
            {!legacyAuthenticated && (
              <Button
                size="sm"
                variant="outline"
                disabled={legacyAuthLoading || legacyAuthBusy}
                onClick={() => void handleLegacySignIn()}
              >
                {legacyAuthBusy ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <ShieldCheck className="mr-2 size-3.5" />}
                Hubungkan akun Convex lama
              </Button>
            )}
            {backendState.status === "authenticated" && legacyAuthenticated && (
              <Button
                size="sm"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => void handleMigration()}
              >
                {busy ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <ArrowRightLeft className="mr-2 size-3.5" />}
                Migrasikan data Convex sekarang
              </Button>
            )}
          </div>
        </div>

        {legacyAuthError && <p role="alert" className="text-xs text-destructive">{legacyAuthError}</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        {result && (
          <div
            role={result.reconciled ? "status" : "alert"}
            className={result.reconciled
              ? "rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3"
              : "rounded-md border border-destructive/30 bg-destructive/5 p-3"}
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className={result.reconciled ? "size-4 text-emerald-500" : "size-4 text-destructive"} />
              {result.reconciled ? "Transfer data berhasil direkonsiliasi" : "Rekonsiliasi data gagal"}
            </div>
            <p className="text-xs text-muted-foreground">
              Sumber: {result.totalSource} record · masuk: {result.totalInserted} · dilewati: {result.totalSkipped}
            </p>
            {Object.entries(result.sourceCounts).some(([, count]) => count > 0) && (
              <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                {Object.entries(result.sourceCounts)
                  .filter(([, count]) => count > 0)
                  .map(([table, count]) => (
                    <div key={table} className="flex justify-between gap-3 text-[11px] text-muted-foreground">
                      <span>{table}</span>
                      <span className="font-mono tabular-nums">
                        {result.inserted[table] ?? 0} masuk / {result.skipped[table] ?? 0} dilewati dari {count}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Panel ini hanya untuk ekspor satu kali data akun lama. Convex bukan lagi penyedia login atau runtime aplikasi. Jangan hapus database lama sebelum jumlah record hasil migrasi dan kepemilikan datanya direkonsiliasi.
        </p>
      </CardContent>
    </Card>
  );
}
