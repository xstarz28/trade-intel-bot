import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const mcpApi = (api as any).mcp;

export default function ConnectPage() {
  if (window.top !== window.self) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">Open this page directly</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            For your security, agent access cannot be approved inside another site's frame.
          </p>
        </section>
      </main>
    );
  }

  return <ConnectPrompt />;
}

function ConnectPrompt() {
  const [requestId, setRequestId] = useState(
    () => new URLSearchParams(window.location.search).get("request") ?? "",
  );

  if (!requestId) return <EnterCode onFound={setRequestId} />;
  return <ApproveRequest requestId={requestId} />;
}

function EnterCode({ onFound }: { onFound: (requestId: string) => void }) {
  const find = useMutation(mcpApi.findAuthRequest);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await find({ userCode: code.trim().toUpperCase() });
      if (id) onFound(id);
      else setError("Kode tidak valid atau sudah kedaluwarsa.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
        <h1 className="text-lg font-semibold">Hubungkan AI agent</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Masukkan kode yang sedang ditampilkan oleh aplikasi AI agent Anda.
        </p>
        <form onSubmit={submit} className="mt-5 flex gap-2">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || code.trim().length < 4}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Lanjut
          </button>
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>
    </main>
  );
}

function ApproveRequest({ requestId }: { requestId: string }) {
  const request = useQuery(mcpApi.getAuthRequest, { requestId });
  const authorize = useAction(mcpApi.authorize);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (result) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">{result === "approved" ? "Agent terhubung" : "Akses ditolak"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {result === "approved"
              ? "Persetujuan selesai. Kembali ke ChatGPT untuk melanjutkan koneksi."
              : "Agent tidak diberi akses ke akun XSTARZG Anda."}
          </p>
        </section>
      </main>
    );
  }

  if (request === undefined) {
    return <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">Memuat permintaan…</main>;
  }

  if (!request || request.status !== "pending") {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">Permintaan kedaluwarsa</h1>
          <p className="mt-2 text-sm text-muted-foreground">Mulai ulang koneksi dari aplikasi AI agent Anda.</p>
        </section>
      </main>
    );
  }

  const isDevice = request.kind === "device";
  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await authorize({
        requestId,
        approve,
        ...(isDevice && approve ? { userCode: request.userCode } : {}),
      });
      if (response.redirectUrl) window.location.assign(response.redirectUrl);
      else setResult(approve ? "approved" : "denied");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  let redirectHost = "klien AI";
  if (request.redirectUri) {
    try {
      redirectHost = new URL(request.redirectUri).host;
    } catch {
      redirectHost = "klien AI";
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">XSTARZG · MCP OAuth</p>
        <h1 className="mt-2 text-xl font-semibold">Hubungkan AI agent?</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          <strong className="text-foreground">{request.clientName ?? "AI agent"}</strong>{" "}
          <span>(nama belum diverifikasi)</span> meminta akses ke {request.serverName ?? "XSTARZG Analysis"}.
        </p>
        <div className="mt-5 rounded-lg border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Izin yang diminta</p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
            {request.scopes.map((scope: { name: string; description: string }) => (
              <li key={scope.name}>{scope.description}</li>
            ))}
          </ul>
        </div>
        {isDevice ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm">
              Pastikan kode ini sama persis dengan kode yang ditampilkan di ChatGPT:
            </p>
            <p className="rounded-lg bg-muted px-4 py-3 text-center font-mono text-xl font-bold tracking-widest">
              {request.userCode}
            </p>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1"
              />
              Saya memulai koneksi ini sendiri dan kode di atas cocok dengan kode di ChatGPT.
            </label>
            <p className="text-xs text-muted-foreground">Jika seseorang mengirim tautan ini kepada Anda, pilih Tolak.</p>
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">
            Setelah disetujui, Anda akan kembali ke <code>{redirectHost}</code>.
          </p>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide(false)}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Tolak
          </button>
          <button
            type="button"
            disabled={busy || (isDevice && !confirmed)}
            onClick={() => void decide(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Izinkan akses
          </button>
        </div>
      </section>
    </main>
  );
}
