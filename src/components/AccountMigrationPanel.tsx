import { useState } from "react";
import { useConvex } from "convex/react";
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
  const { state: backendState, refresh } = useBackendSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    totalInserted: number;
    totalSkipped: number;
    inserted: Record<string, number>;
    skipped: Record<string, number>;
  } | null>(null);

  if (backendState.status === "error" && backendState.error instanceof BackendApiError && backendState.error.status === 404) {
    return null;
  }

  const handleMigration = async () => {
    setError(null);
    if (backendState.status !== "authenticated") {
      window.location.assign(getBackendGoogleSignInUrl());
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
          Pindahkan riwayat dan data pribadi dari Convex ke database SQLite milik Trade Intel.
          Data Convex asli tidak dihapus.
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

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="w-full sm:w-auto"
            disabled={busy || backendState.status === "loading" || backendState.status === "error"}
            onClick={() => void handleMigration()}
          >
            {busy ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <ArrowRightLeft className="mr-2 size-3.5" />}
            {backendState.status === "authenticated" ? "Migrasikan data Convex sekarang" : "Hubungkan akun backend"}
          </Button>
          {backendState.status === "authenticated" && backendState.user.isAnonymous && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => window.location.assign(getBackendGoogleSignInUrl())}
            >
              Hubungkan Google
            </Button>
          )}
        </div>

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        {result && (
          <div role="status" className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-emerald-500" />
              Transfer data selesai
            </div>
            <p className="text-xs text-muted-foreground">
              {result.totalInserted} record dipindahkan; {result.totalSkipped} record dilewati karena sudah ada atau memiliki konflik unik.
            </p>
          </div>
        )}

        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Ini hanya memindahkan data akun. Aplikasi tetap memakai Convex sampai seluruh fitur backend
          dan autentikasi selesai diverifikasi; jangan hapus atau matikan data lama.
        </p>
      </CardContent>
    </Card>
  );
}
