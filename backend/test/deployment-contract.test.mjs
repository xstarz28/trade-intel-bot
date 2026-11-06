import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/self-hosted-deploy.yml", import.meta.url),
  "utf8",
);

describe("self-hosted deployment safety contract", () => {
  it("backs up the persistent SQLite volume before switching the release symlink, including first cutover", () => {
    const backup = workflow.indexOf('node backend/backup.mjs "/data/backups/predeploy-$SHA.sqlite" --if-exists');
    const switchRelease = workflow.indexOf('mv -Tf "$APP_DIR/current.next" "$APP_DIR/current"');
    assert.notEqual(backup, -1, "deployment must create a pre-deploy SQLite snapshot");
    assert.notEqual(switchRelease, -1, "deployment must switch releases atomically");
    assert.ok(backup < switchRelease, "database snapshot must finish before release cutover");

    const backupBlock = workflow.slice(workflow.indexOf("# Snapshot the persistent data volume"), switchRelease);
    assert.match(backupBlock, /"\$RELEASE_DIR\/backend\/compose\.yaml"/);
    assert.doesNotMatch(backupBlock, /if \[ -n "\$PREVIOUS" \]/,
      "first self-hosted deployment must also snapshot an existing persistent volume");
  });
});
