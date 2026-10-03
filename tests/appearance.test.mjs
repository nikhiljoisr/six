import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppearance } from "../src/lib/appearance.ts";

test("light is the default, whatever macOS is set to", () => {
  assert.equal(resolveAppearance("light", true), "light");
  assert.equal(resolveAppearance(undefined, true), "light");
  assert.equal(resolveAppearance(null, true), "light");
  assert.equal(resolveAppearance("sepia", true), "light");
});

test("dark is dark, and auto follows macOS", () => {
  assert.equal(resolveAppearance("dark", false), "dark");
  assert.equal(resolveAppearance("auto", true), "dark");
  assert.equal(resolveAppearance("auto", false), "light");
});
