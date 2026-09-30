/**
 * Phase 299 — `/build` renders, in a real DOM, the facts the artifact carries.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/verify-frontend-artifact.mjs` can prove that the BUILT bundle embeds
 * the commit, the branch and the instant. It cannot prove the page then renders
 * them: a typo in a key path, a missing i18n section or a page that throws on
 * mount would leave the checker green and the person opening `/build` with a
 * blank screen. That is the same "green process, wrong artifact" failure this
 * phase exists to remove, so the page gets rendered here with the real i18n
 * provider and the real build-info module.
 *
 * WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 * --------------------------------------------------
 * It asserts the values shown are the artifact's own, and that no credential,
 * author, remote or environment value can appear — the page is public, so its
 * disclosure surface is part of its contract, not an implementation detail.
 * Nothing here asserts on translated sentence wording (that is the i18n
 * suite's job) or on styling.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n";

const BUILD_INFO = {
  schema: "xstarz.build-info/v1",
  commit: "b298c3c7b26d6974a5cba8cf6aaa8d53059ee7bc",
  shortCommit: "b298c3c7",
  branch: "arena/01a0d195-trade-intel-bot",
  builtAt: "2026-09-30T05:02:36.000Z",
  source: "git",
  worktreeDirty: false,
  unsafeSource: false,
};

vi.mock("@/lib/build-info", async () => {
  const actual = await vi.importActual<typeof import("@/lib/build-info")>("@/lib/build-info");
  return {
    ...actual,
    getBuildInfo: () => ({ ...BUILD_INFO }),
    isUnsafeDeploymentSource: () => false,
  };
});

import BuildInfo from "./BuildInfo";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/build"]}>
      <I18nProvider>
        <BuildInfo />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("299 — /build shows the artifact's own provenance", () => {
  it("renders the commit, branch, instant and schema the build embedded", () => {
    renderPage();
    expect(screen.getByText(BUILD_INFO.commit)).toBeTruthy();
    expect(screen.getByText(BUILD_INFO.shortCommit)).toBeTruthy();
    expect(screen.getByText(BUILD_INFO.branch)).toBeTruthy();
    expect(screen.getByText(BUILD_INFO.builtAt)).toBeTruthy();
    expect(screen.getByText(BUILD_INFO.schema)).toBeTruthy();
  });

  it("discloses no author, message, remote, environment value or credential", () => {
    const { container } = renderPage();
    const text = container.textContent ?? "";
    for (const forbidden of [
      "github.com",
      "git@",
      "author",
      "committer",
      "message",
      "CONVEX_",
      "AUTH_",
      "DEPLOY_KEY",
      "token",
      "secret",
      "process.env",
    ]) {
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps the warning path honest: an invalid source is named, not hidden", () => {
    // The page reads the branch from the same object it displays, so the
    // warning cannot name a different ref than the one on screen — checked
    // structurally, because that mismatch is exactly the kind of quiet
    // untruth this route exists to prevent.
    const source = readFileSync(join(process.cwd(), "src/pages/BuildInfo.tsx"), "utf8");
    expect(source).toMatch(/isUnsafeDeploymentSource\(\)/);
    expect(source).toMatch(/copy\.unsafeSource\.replace\("\{branch\}", info\.branch\)/);
  });
});
