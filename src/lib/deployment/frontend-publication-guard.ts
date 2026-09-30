/**
 * Phase 300 — fail-closed guard in front of a BROWSER-FACING frontend publication.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 299 made the built artifact prove which revision it is, and pinned the
 * ref the development deploy builds from. It also found the remaining hole: no
 * repository workflow publishes the frontend, so a green deploy refreshed the
 * Convex backend while the browser-facing site kept serving whatever the
 * external host had built from `main`.
 *
 * A publication is therefore its own decision, with its own inputs, and it is
 * the one decision that cannot be inferred from a pipeline, a workflow status,
 * an artifact listing or a deploy log. It can be inferred from exactly one
 * thing: fetching the public URL and reading the provenance that URL serves.
 *
 * WHAT THIS GUARD DECIDES
 * -----------------------
 * Exactly one question — *may this run publish the verified artifact to the
 * development frontend, or verify a URL that is already published?* It:
 *
 *   · requires an explicit source pin and refuses `main` (imported rule, not
 *     restated) as well as every other ref by name;
 *   · requires a browser-facing https origin to verify against — "publish" with
 *     nothing to fetch afterwards is not a publication, it is a hope;
 *   · reports whether the host credential is PRESENT, and never its value;
 *   · refuses to publish without that credential rather than silently skipping
 *     the upload and leaving the run green.
 *
 * WHAT IT DOES NOT DO OR CLAIM
 * ----------------------------
 * It does not contact the host, does not deploy, does not read an ambient
 * environment, does not print a credential, and never returns a pass for the
 * publication itself:
 *
 *   `READY_TO_PUBLISH` means "the ref is the pinned one, a target exists and a
 *   credential is present". It does NOT mean the artifact was uploaded, that
 *   the upload replaced the browser-facing build, or that a browser now sees
 *   the current branch. Only `verify-published-frontend.mjs` against the real
 *   URL can say that, and until it does, `frontendVerified` stays false.
 *
 * A green GitHub workflow is not a frontend deployment. That sentence is the
 * whole reason this module exists.
 */
import { isForbiddenDeploySourceRef } from "./production-deploy-guard";
import { normalizeGitRef } from "../build-provenance";

export const FRONTEND_PUBLICATION_GUARD_SCHEMA = "phase300.frontend-publication-guard/v1";

export type FrontendPublicationGuardState =
  | "READY_TO_PUBLISH"
  | "READY_TO_VERIFY_ONLY"
  | "MISSING_SOURCE_PIN"
  | "FORBIDDEN_SOURCE_REF"
  | "WRONG_SOURCE_BRANCH"
  | "MISSING_HOST_URL"
  | "HOST_CREDENTIAL_ABSENT";

export const FRONTEND_PUBLICATION_GUARD_PRECEDENCE: readonly FrontendPublicationGuardState[] = [
  "MISSING_SOURCE_PIN",
  "FORBIDDEN_SOURCE_REF",
  "WRONG_SOURCE_BRANCH",
  "MISSING_HOST_URL",
  "HOST_CREDENTIAL_ABSENT",
  "READY_TO_PUBLISH",
  "READY_TO_VERIFY_ONLY",
];

export type FrontendPublicationMode = "publish" | "verify-only";

export interface FrontendPublicationGuardInput {
  /**
   * Git ref this run is checking out (`SOURCE_REF` / `GITHUB_REF`).
   * `main` is refused by the repository-wide rule; the pin refuses the rest.
   */
  sourceRef?: string;
  /**
   * The branch the frontend MUST be built from. Required: publication without a
   * source pin is exactly the failure this phase closes, so an absent pin is a
   * refusal (`MISSING_SOURCE_PIN`), not a licence to proceed.
   */
  requiredSourceBranch?: string;
  /** The browser-facing origin to publish to and/or verify (https only). */
  hostUrl?: string;
  /** `publish` uploads then verifies; `verify-only` only fetches. */
  mode?: FrontendPublicationMode;
  /**
   * Host credential PRESENCE. Values are never accepted, stored or printed by
   * this module — a guard that can echo a token is a guard that leaks.
   */
  hostCredential?: {
    tokenPresent?: boolean;
    projectPresent?: boolean;
    orgPresent?: boolean;
  };
}

export interface FrontendPublicationGuardReport {
  schema: string;
  state: FrontendPublicationGuardState;
  mode: FrontendPublicationMode;
  /** True only for a publish run with the pin, a target and a credential. */
  mayPublish: boolean;
  /** True when there is a real URL this run is allowed to fetch and judge. */
  mayVerify: boolean;
  /** A guard is permission to attempt; it is never a result. */
  publicationPerformed: false;
  /** Only `verify-published-frontend.mjs` against the real URL may set this. */
  frontendVerified: false;
  /** Normalised ref this run would build from. */
  sourceRef: string | null;
  /** The pin, as given (normalised). */
  requiredSourceBranch: string | null;
  /** https origin only — never a credential, path query or fragment. */
  hostUrl: string | null;
  /** A path was supplied and dropped when the origin was taken. */
  hostUrlIgnoredPath: string | null;
  hostCredential: { tokenPresent: boolean; projectPresent: boolean; orgPresent: boolean };
  problems: string[];
  statement: string;
}

const SCHEME = /^https:\/\//i;

/**
 * Reduce a configured URL to the origin the checks will fetch, reporting any
 * path that was dropped rather than silently ignoring it: a URL with a path is
 * usually a mistake (someone pasted a deep link), and the operator should see
 * that the guard used the origin.
 */
function hostOrigin(raw: string | undefined): { origin: string | null; ignoredPath: string | null } {
  const value = (raw ?? "").trim();
  if (value.length === 0) return { origin: null, ignoredPath: null };
  if (!SCHEME.test(value)) return { origin: null, ignoredPath: null };
  try {
    const url = new URL(value);
    const ignoredPath = url.pathname === "/" || url.pathname === "" ? null : `${url.pathname}${url.search}`;
    return { origin: url.origin, ignoredPath };
  } catch {
    return { origin: null, ignoredPath: null };
  }
}

export function evaluateFrontendPublicationGuard(
  input: FrontendPublicationGuardInput,
): FrontendPublicationGuardReport {
  const mode: FrontendPublicationMode = input.mode === "verify-only" ? "verify-only" : "publish";
  const requiredSourceBranch = (input.requiredSourceBranch ?? "").trim();
  const sourceRefRaw = (input.sourceRef ?? "").trim();
  const sourceRef = sourceRefRaw.length > 0 ? normalizeGitRef(sourceRefRaw) : null;
  const pin = requiredSourceBranch.length > 0 ? normalizeGitRef(requiredSourceBranch) : null;
  const { origin, ignoredPath } = hostOrigin(input.hostUrl);
  const credential = {
    tokenPresent: input.hostCredential?.tokenPresent === true,
    projectPresent: input.hostCredential?.projectPresent === true,
    orgPresent: input.hostCredential?.orgPresent === true,
  };

  const problems: string[] = [];
  const add = (problem: string) => problems.push(problem);

  if (pin === null) {
    add(
      "no source pin was given; a frontend publication must name the branch it builds from, so an absent pin is refused",
    );
  }
  if (sourceRef !== null && isForbiddenDeploySourceRef(sourceRef)) {
    add(
      "source ref is main; main still serves the leaked OTP credential at its tip and must not be published to any frontend",
    );
  } else if (sourceRef === null) {
    add("no source ref was given, so the pinned branch cannot be checked");
  } else if (pin !== null && sourceRef !== pin) {
    add(
      `source ref ${sourceRef} is not the pinned frontend source branch ${pin}; this publication must be built from that branch`,
    );
  }
  if (origin === null) {
    add(
      "no https browser-facing origin was given; a publication nobody can fetch afterwards cannot be verified and is not accepted",
    );
  }
  if (mode === "publish" && !(credential.tokenPresent && credential.orgPresent && credential.projectPresent)) {
    add(
      "the host credential is absent (token/organisation/project); refusing to publish rather than skipping the upload and leaving the run green",
    );
  }

  const state: FrontendPublicationGuardState = problems.some((p) => p.includes("no source pin"))
    ? "MISSING_SOURCE_PIN"
    : sourceRef !== null && isForbiddenDeploySourceRef(sourceRef)
      ? "FORBIDDEN_SOURCE_REF"
      : pin !== null && sourceRef !== null && sourceRef !== pin
        ? "WRONG_SOURCE_BRANCH"
        : origin === null
          ? "MISSING_HOST_URL"
          : mode === "publish" && problems.some((p) => p.includes("host credential is absent"))
            ? "HOST_CREDENTIAL_ABSENT"
            : mode === "verify-only"
              ? "READY_TO_VERIFY_ONLY"
              : "READY_TO_PUBLISH";

  const mayPublish = state === "READY_TO_PUBLISH";
  const mayVerify = origin !== null && pin !== null && sourceRef === pin;

  const statement = mayPublish
    ? "The ref is the pinned branch, a browser-facing origin is configured and a host credential is present. This is permission to attempt a publication, not a publication: only fetching the published URL and reading its provenance decides whether a browser now receives this branch."
    : state === "READY_TO_VERIFY_ONLY"
      ? "Verify-only: the pinned branch and a browser-facing origin are known, so the published URL may be fetched and judged. Nothing will be uploaded, and no result about the publication is implied until that fetch happens."
      : "Frontend publication is refused. This is a missing or wrong input, not a negative result about any live site.";

  return {
    schema: FRONTEND_PUBLICATION_GUARD_SCHEMA,
    state,
    mode,
    mayPublish,
    mayVerify,
    publicationPerformed: false,
    frontendVerified: false,
    sourceRef,
    requiredSourceBranch: pin,
    hostUrl: origin,
    hostUrlIgnoredPath: ignoredPath,
    hostCredential: credential,
    problems,
    statement,
  };
}
