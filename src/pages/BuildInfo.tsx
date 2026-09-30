/**
 * Phase 299 — `/build`: the deployed artifact identifying itself.
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * A browser-facing site can be served by a host that rebuilds on its own
 * schedule, and the same URL has served both the current product UI and a
 * retired build-platform scaffold. Deciding which one a person is looking at
 * must not require comparing colours. This route answers it in one line, from
 * the artifact's own embedded metadata:
 *
 *   `/build`            — the page below (human-readable)
 *   `/build-info.json`  — the same facts as a static file, no JavaScript
 *   `<meta name="xstarz-build-commit">` in the served HTML — a plain `curl`
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW
 * ----------------------------------
 * No author, message, remote or environment value, and nothing about the
 * current user. Commit id, branch, build instant and the source of that
 * information — the minimum needed to answer "is this the revision I think it
 * is?" without becoming a disclosure surface. It is readable by anyone, which
 * is the point: a provenance page only an operator can read cannot settle a
 * disagreement about what is deployed.
 *
 * Copy lives in the i18n resources like every other page (Phase 189). The
 * VALUES are never translated: a commit id, a branch name and an ISO instant
 * mean the same thing in every locale, and paraphrasing them would make the
 * page useless for its one job.
 */

import { Link } from "react-router";
import { useI18n } from "@/lib/i18n";
import { getBuildInfo, isUnsafeDeploymentSource, BUILD_INFO_SCHEMA } from "@/lib/build-info";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm text-foreground break-all">{value}</dd>
    </div>
  );
}

export default function BuildInfo() {
  const { t } = useI18n();
  const copy = t.buildInfo;
  const info = getBuildInfo();
  const unsafe = isUnsafeDeploymentSource();

  return (
    <div className="min-h-screen bg-background px-4 py-12 text-foreground">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.intro}</p>

        <dl className="mt-8">
          <Row label={copy.commitLabel} value={info.commit} />
          <Row label={copy.shortCommitLabel} value={info.shortCommit} />
          <Row label={copy.branchLabel} value={info.branch} />
          <Row label={copy.builtAtLabel} value={info.builtAt} />
          <Row label={copy.sourceLabel} value={info.source} />
          <Row label={copy.schemaLabel} value={BUILD_INFO_SCHEMA} />
        </dl>

        {unsafe && (
          <p
            role="alert"
            className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {copy.unsafeSource.replace("{branch}", info.branch)}
          </p>
        )}

        <p className="mt-6 text-sm text-muted-foreground">{copy.machineReadable}</p>

        <Link className="mt-8 inline-block text-sm text-primary underline" to="/">
          {copy.backToApp}
        </Link>
      </div>
    </div>
  );
}
