import fs from "fs";
import assert from "assert";

// Pull the two helpers out of worker.js and eval them, so the test runs
// against the real shipped source rather than a copy that can drift.
const src = fs.readFileSync("worker.js", "utf8");
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `could not find function ${name}`);
  let depth = 0, i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
// A function *declaration* eval'd inside an ES module (strict mode) doesn't
// create a binding we can see, so wrap each in parens to make it an
// expression and hang the result on globalThis.
const matchEditPassword = eval("(" + extract("matchEditPassword") + ")");
const safeLabel = eval("(" + extract("safeLabel") + ")");
globalThis.safeLabel = safeLabel; // matchEditPassword doesn't call safeLabel, but keep them consistent

let pass = 0;
function t(desc, fn) {
  try { fn(); console.log("  ok  " + desc); pass++; }
  catch (e) { console.log("  FAIL " + desc + "\n       " + e.message); process.exitCode = 1; }
}

const TABLE = JSON.stringify({ admin: "recipeadmin", kory: "koryspw", "temp-chef": "throwaway123" });

console.log("\nmulti-password table");
t("admin password matches, returns its label", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, "recipeadmin"), "admin"));
t("second password matches", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, "koryspw"), "kory"));
t("third password matches", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, "throwaway123"), "temp-chef"));
t("wrong password rejected", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, "nope"), null));
t("label is not accepted as a password", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, "kory"), null));

console.log("\nrevocation actually revokes (the footgun test)");
const REVOKED = JSON.stringify({ kory: "koryspw" });
t("deleting an entry rejects that password", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: REVOKED }, "recipeadmin"), null));
t("...even while the legacy EDIT_PASSWORD secret still holds it", () =>
  assert.strictEqual(
    matchEditPassword({ EDIT_PASSWORDS: REVOKED, EDIT_PASSWORD: "recipeadmin" }, "recipeadmin"), null));
t("remaining entries still work after a revocation", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: REVOKED }, "koryspw"), "kory"));

console.log("\nlegacy fallback (nothing breaks before migrating)");
t("EDIT_PASSWORD alone still works", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORD: "recipeadmin" }, "recipeadmin"), "admin"));
t("EDIT_PASSWORD alone rejects a wrong password", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORD: "recipeadmin" }, "wrong"), null));
t("no secrets set at all rejects everything", () =>
  assert.strictEqual(matchEditPassword({}, "recipeadmin"), null));

console.log("\nmalformed config falls back instead of locking everyone out");
t("invalid JSON falls back to EDIT_PASSWORD", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: "{not json", EDIT_PASSWORD: "recipeadmin" }, "recipeadmin"), "admin"));
t("empty object falls back to EDIT_PASSWORD", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: "{}", EDIT_PASSWORD: "recipeadmin" }, "recipeadmin"), "admin"));
t("array instead of object falls back", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: '["a"]', EDIT_PASSWORD: "recipeadmin" }, "recipeadmin"), "admin"));
t("invalid JSON with no fallback rejects", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: "{not json" }, "recipeadmin"), null));

console.log("\nempty / junk input is never accepted");
t("empty string rejected", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, ""), null));
t("undefined rejected (missing body.password)", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, undefined), null));
t("null rejected", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, null), null));
t("non-string rejected", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: TABLE }, 12345), null));
t("empty-string password in table cannot be matched by empty input", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: '{"broken":""}' }, ""), null));
t("null-valued entry in table does not crash or match", () =>
  assert.strictEqual(matchEditPassword({ EDIT_PASSWORDS: '{"a":null,"b":"good"}' }, "good"), "b"));

console.log("\ncommit-message label sanitizing");
t("normal label passes through", () => assert.strictEqual(safeLabel("kory"), "kory"));
t("newlines stripped", () => assert.strictEqual(safeLabel("kory\nInject: bad"), "kory Inject: bad"));
t("over-long label truncated", () => assert.strictEqual(safeLabel("x".repeat(80)).length, 40));
t("empty label becomes 'unknown'", () => assert.strictEqual(safeLabel("   "), "unknown"));

console.log(`\n${pass} passed${process.exitCode ? " — WITH FAILURES" : ", 0 failed"}\n`);
