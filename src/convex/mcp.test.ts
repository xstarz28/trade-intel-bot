import { describe, expect, it } from "vitest";
import { mcp } from "./mcp";

describe("XSTARZG MCP tool contract", () => {
  it("has no missing scopes or safety annotations", () => {
    expect(mcp.lint()).toEqual([]);
  });
});
