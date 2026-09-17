/**
 * Crabby's Recipe Hub — secure save endpoint + site password gate + image upload
 *
 * This Worker holds the GitHub token and all passwords as encrypted
 * secrets, set via the Cloudflare dashboard. None of these values ever
 * appear in any file served to a browser.
 *
 * Recipe data lives at data/recipes.json in the crabbys-recipe-hub repo
 * (not a separate Gist anymore) — this avoids GitHub's ~1MB truncation
 * limit on Gist API reads now that the file has grown past that size.
 *
 * Set these secrets in the Cloudflare dashboard (Workers > your worker > Settings > Variables):
 *
 *   EDIT_PASSWORDS  -> a JSON string mapping a LABEL -> password. Any one of
 *                      these unlocks editing. The label is only used for the
 *                      git commit message, so you can see who saved what.
 *                      Labels should be short and have no colons.
 *                      Example value to paste into this one secret:
 *                      {"admin":"recipeadmin","kory":"koryspassword","temp-chef":"throwaway123"}
 *
 *                      TO REVOKE ONE: edit this secret, delete that entry,
 *                      save. Effective immediately for new unlocks and new
 *                      saves. Anyone already unlocked in an open tab keeps
 *                      their unlocked UI until their next save attempt,
 *                      which will then be rejected.
 *
 *   EDIT_PASSWORD   -> LEGACY, single password. Used ONLY when EDIT_PASSWORDS
 *                      is unset or empty, so nothing breaks before you
 *                      migrate. Once EDIT_PASSWORDS is set, this secret is
 *                      ignored completely — that is deliberate, so that
 *                      deleting an entry from EDIT_PASSWORDS actually revokes
 *                      it rather than silently falling back to here.
 *                      Delete this secret once you've migrated.
 *
 *   GITHUB_TOKEN    -> GitHub personal access token — needs "repo" scope
 *                      (used for both recipe data saves and image uploads)
 *   GH_REPO_OWNER   -> Lw00d
 *   GH_REPO_NAME    -> crabbys-recipe-hub
 *   USERS_JSON      -> a JSON string mapping username -> {password, location, store}.
 *                      "location" is the RECIPE BOOK the store reads from, one of:
 *                      "CBG", "CDS", "Palm", "Salty's Island",
 *                      "Salty Crab North Beach" — or "all" for full access.
 *                      "store" is the individual site name shown in the header;
 *                      several stores can share one book. Optional — falls back
 *                      to the book name when absent.
 *                      "code" is the stable per-store key shared with the Prep
 *                      Hub (csc-stcloud, cbg-nsb, cbp-staugustine,
 *                      cbg-beachwalk, cds-dockside, cds-oceanside, si-island,
 *                      nb-crab, cbp-pavilion). Per-store data keys off this,
 *                      so never change one once it is in use.
 *                      "location" must exactly match one of: "Salty Crab North Beach",
 *                      "CDS", "Palm", "CBG", "Salty's Island", "Mar Vista",
 *                      "Sandbar", "Beach House" — or "all" for full access.
 *                      Example value to paste into this one secret:
 *                      {"crabbys":{"password":"managerpass","location":"all"},
 *                       "cds_staff":{"password":"cdspass123","location":"CDS"},
 *                       "cbg_staff":{"password":"cbgpass123","location":"CBG"}}
 *
 * NOTE: USERS_JSON (who can log in / which store they see) and EDIT_PASSWORDS
 * (who can edit) are separate systems on purpose. A login gets you in; an
 * edit password unlocks editing regardless of which login you used.
 *
 * Staff should visit THIS Worker's URL (not the raw GitHub Pages link) —
 * this is where the login prompt lives.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ORIGIN_BASE = "https://lw00d.github.io/crabbys-recipe-hub";

const PREP_HUB_BASE = "https://bshg-prep-hub.bshgrp.workers.dev";
// The nine live stores. Shared verbatim with the Prep Hub; the three deferred
// sites (Mar Vista, Beach House, Sandbar) are deliberately absent.
const PREP_STORE_CODES = [
  "csc-stcloud", "cbg-nsb", "cbp-staugustine", "cbg-beachwalk",
  "cds-dockside", "cds-oceanside", "si-island", "nb-crab", "cbp-pavilion",
];
// Allowlisted sub-paths. An allowlist rather than a pass-through so this can
// never be used to reach arbitrary Prep Hub endpoints.
const PREP_PATHS = [
  /^prep-items$/,
  /^prep-days\/\d{4}-\d{2}-\d{2}\/status$/,
  /^prep-days\/\d{4}-\d{2}-\d{2}\/(start|finish|reopen)$/,
  /^prep-days\/\d{4}-\d{2}-\d{2}\/count(\/complete)?$/,
  /^prep-days\/\d{4}-\d{2}-\d{2}\/count\/[A-Za-z0-9._~:@+-]+$/,
  /^prep-days\/\d{4}-\d{2}-\d{2}\/counts$/,
  // The item id lives in the PATH, not the body. Several plausible shapes are
  // allowed so the exact one can be confirmed without another deploy.
  /^prep-days\/\d{4}-\d{2}-\d{2}\/(prepped|prep|on-hand|onhand)\/[A-Za-z0-9._~:@+-]+$/,
  // Counting and prep logging hang off the ITEM, not the day: the item id is a
  // path segment after prep-items and the date travels in the body.
  /^prep-items\/[A-Za-z0-9._~:@+-]+\/count$/,
  /^prep-items\/[A-Za-z0-9._~:@+-]+\/count\/complete$/,
  /^yield-items$/,
  /^yield-items\/[A-Za-z0-9._~:@+-]+\/tests$/,
];

// Re-verify the Basic Auth credentials the browser sends. The store scope is
// taken from here and never from the request, so a login cannot ask for
// another store's data.
function authenticatedUser(request, env) {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Basic ")) return null;
  let users;
  try { users = JSON.parse(env.USERS_JSON); } catch (e) { return null; }
  let decoded;
  try { decoded = atob(header.slice(6)); } catch (e) { return null; }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  const u = users[decoded.slice(0, i)];
  return (u && u.password === decoded.slice(i + 1)) ? u : null;
}

/**
 * Check a supplied edit password against every configured password.
 *
 * Returns the LABEL of the matching password, or null if there's no match.
 * A label is truthy and null is falsy, so `if (matchEditPassword(...))`
 * reads the same way the old `password === env.EDIT_PASSWORD` check did.
 *
 * Resolution order:
 *   1. EDIT_PASSWORDS, if it's set and parses to a non-empty object.
 *   2. Otherwise EDIT_PASSWORD, under the label "admin".
 * Never both — see the EDIT_PASSWORDS note in the header comment.
 */
function matchEditPassword(env, supplied) {
  if (typeof supplied !== "string" || supplied === "") return null;

  let table = null;
  if (env.EDIT_PASSWORDS) {
    try {
      const parsed = JSON.parse(env.EDIT_PASSWORDS);
      // Must be a plain object of label -> string. Anything else is a config
      // mistake; fall through to the legacy secret rather than locking
      // everyone out of editing.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        table = parsed;
      } else {
        console.error("EDIT_PASSWORDS parsed but is not a non-empty object — ignoring it");
      }
    } catch (e) {
      console.error("EDIT_PASSWORDS is not valid JSON — ignoring it");
    }
  }

  if (!table) {
    if (!env.EDIT_PASSWORD) return null;
    table = { admin: env.EDIT_PASSWORD };
  }

  for (const label of Object.keys(table)) {
    if (typeof table[label] === "string" && table[label] !== "" && table[label] === supplied) {
      return label;
    }
  }
  return null;
}

/**
 * Deterministic JSON: object keys sorted at every level. Used to compare a
 * recipe the browser loaded against the one currently on disk, so key
 * ordering can never masquerade as a real change.
 */
function stable(v){
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}

/**
 * Apply a set of per-recipe changes onto the current array.
 *
 * Policy is last-writer-wins: an edit always lands, even if someone else
 * changed that same recipe since the browser loaded it. But those cases are
 * REPORTED back so the person who saved finds out they stepped on someone —
 * silently diverging copies is how linked recipes drifted apart before.
 *
 * changed: [{ id, base, recipe }]  base = stable() of the version the browser
 *                                  loaded, or null for a brand-new recipe
 * deleted: [{ id, base }]
 *
 * Pure function — no I/O — so it can be unit tested and so it can safely be
 * re-run from scratch against fresh data when GitHub rejects our write.
 */
function mergeRecipes(current, changed, deleted){
  const next = current.slice();
  const pos = new Map();
  next.forEach((r, i) => { if (r && r.id != null) pos.set(String(r.id), i); });

  const report = { updated: [], inserted: [], removed: [], overwrote: [], alreadyGone: [], resurrected: [] };

  for (const c of changed) {
    const id = String(c.id);
    const at = pos.get(id);
    if (at === undefined) {
      // Not on disk. Either genuinely new, or someone deleted it while this
      // browser was editing it. Either way the edit is kept.
      next.push(c.recipe);
      pos.set(id, next.length - 1);
      (c.base === null || c.base === undefined ? report.inserted : report.resurrected).push(id);
      continue;
    }
    if (c.base !== null && c.base !== undefined && stable(next[at]) !== c.base) {
      report.overwrote.push(id);   // changed by someone else since load
    }
    next[at] = c.recipe;
    report.updated.push(id);
  }

  const dropping = new Set();
  for (const d of deleted) {
    const id = String(d.id);
    const at = pos.get(id);
    if (at === undefined) { report.alreadyGone.push(id); continue; }
    if (d.base !== null && d.base !== undefined && stable(next[at]) !== d.base) {
      report.overwrote.push(id);   // deleting something someone else just edited
    }
    dropping.add(at);
    report.removed.push(id);
  }

  const merged = dropping.size ? next.filter((_, i) => !dropping.has(i)) : next;
  return { merged, report };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── Editing endpoints — password-checked at the application level,
    // intentionally not gated by Basic Auth so the page's own fetch() calls work. ──
    if (url.pathname === "/verify" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch (e) { return jsonResponse({ error: "Invalid request body" }, 400); }
      const label = matchEditPassword(env, body.password);
      if (!label) {
        return jsonResponse({ error: "Incorrect password" }, 401);
      }
      // The page only checks res.ok, so the label is informational.
      return jsonResponse({ ok: true, label });
    }

    if (url.pathname === "/save" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: "Invalid request body" }, 400);
      }

      const label = matchEditPassword(env, body.password);
      if (!label) {
        return jsonResponse({ error: "Incorrect password" }, 401);
      }

      const isMerge = Array.isArray(body.changed) || Array.isArray(body.deleted);
      const isFull  = Array.isArray(body.recipes);
      if (!isMerge && !isFull) {
        return jsonResponse({ error: "Missing recipes array (or changed/deleted)" }, 400);
      }

      const changed = Array.isArray(body.changed) ? body.changed : [];
      const deleted = Array.isArray(body.deleted) ? body.deleted : [];
      if (isMerge) {
        if (!changed.length && !deleted.length) {
          return jsonResponse({ error: "Nothing to save" }, 400);
        }
        for (const c of changed) {
          if (!c || c.id == null || typeof c.recipe !== "object" || c.recipe === null) {
            return jsonResponse({ error: "Malformed entry in changed[]" }, 400);
          }
          if (String(c.recipe.id) !== String(c.id)) {
            return jsonResponse({ error: `changed[] id mismatch for ${c.id}` }, 400);
          }
        }
        for (const d of deleted) {
          if (!d || d.id == null) return jsonResponse({ error: "Malformed entry in deleted[]" }, 400);
        }
      }

      const dataPath = "data/recipes.json";
      const apiUrl = `https://api.github.com/repos/${env.GH_REPO_OWNER}/${env.GH_REPO_NAME}/contents/${dataPath}`;
      const ghHeaders = {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "crabbys-recipe-hub-worker",
      };

      // Read → merge → write. If GitHub rejects the write because the file
      // moved under us (409), start over from the new content: the merge is a
      // pure function of whatever is currently on disk, so re-running it is
      // always correct and never compounds.
      const MAX_TRIES = 4;
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        const getRes = await fetch(apiUrl, { headers: ghHeaders });
        if (!getRes.ok) {
          const text = await getRes.text();
          return jsonResponse({ error: `Could not read current file (${getRes.status})`, detail: text }, 502);
        }
        const currentFile = await getRes.json();

        // The Contents API refuses to inline files over ~1MB — it returns
        // encoding:"none" with an empty content field, which is why reading
        // currentFile.content here used to blow up on a 2MB recipes.json.
        // Fetch the blob by the sha we're about to write against instead:
        // that's both size-safe and guaranteed to be the exact same version.
        // Using the raw media type also means we get proper UTF-8 text, where
        // atob() would have mangled every "450°F" into mojibake.
        //
        // Read on BOTH paths, not just the merge: the legacy whole-array save
        // needs the current length too, or the empty-list guard below has
        // nothing to compare against and a stale tab posting `recipes: []`
        // silently wipes the file.
        const blobUrl = `https://api.github.com/repos/${env.GH_REPO_OWNER}/${env.GH_REPO_NAME}/git/blobs/${currentFile.sha}`;
        const blobRes = await fetch(blobUrl, {
          headers: { ...ghHeaders, "Accept": "application/vnd.github.v3.raw" },
        });
        if (!blobRes.ok) {
          const text = await blobRes.text();
          return jsonResponse({ error: `Could not read current file blob (${blobRes.status})`, detail: text }, 502);
        }
        const rawText = await blobRes.text();
        let currentArr;
        try {
          currentArr = JSON.parse(rawText);
        } catch (e) {
          return jsonResponse({
            error: "Stored recipes.json could not be parsed",
            detail: `${e.message} (read ${rawText.length} chars for sha ${currentFile.sha})`,
          }, 500);
        }
        if (!Array.isArray(currentArr)) {
          return jsonResponse({ error: "Stored recipes.json is not an array" }, 500);
        }

        let out, report = null;
        if (isMerge) {
          const merged = mergeRecipes(currentArr, changed, deleted);
          out = merged.merged;
          report = merged.report;
        } else {
          out = body.recipes;   // legacy whole-array save, unchanged behaviour
        }

        // No save should ever empty the file — bail rather than write that.
        // This guard covers the legacy path as well as the merge: an empty
        // `recipes` array used to sail past validation, because isFull is only
        // an Array.isArray check, and land as a write that destroyed every
        // recipe in the repo.
        if (!out.length && currentArr.length) {
          return jsonResponse({ error: "Refusing to write an empty recipe list" }, 500);
        }

        // A legacy save replaces the whole file with whatever the tab happens
        // to be holding, so a badly stale one silently drops every recipe
        // added since it loaded. Emptying the file is caught above; this
        // catches the same accident short of zero. Refuse when less than half
        // would survive — exactly half still passes.
        //
        // Deliberately NOT applied to merge saves: there every removal arrives
        // as an explicit id with the version it was based on, so a large
        // shrink is something a person actually asked for, not a stale copy.
        if (isFull && out.length * 2 < currentArr.length) {
          return jsonResponse({
            error: `Refusing to shrink recipes.json from ${currentArr.length} to ${out.length}. ` +
                   `This usually means the page has been open a long time and is saving a stale copy — ` +
                   `hard-refresh and make the change again.`,
          }, 409);
        }

        const content = JSON.stringify(out, null, 2);
        // btoa can't handle multi-byte UTF-8 directly — encode safely first.
        const contentB64 = btoa(unescape(encodeURIComponent(content)));

        const summary = report
          ? [
              report.updated.length   ? `${report.updated.length} edited`     : null,
              report.inserted.length  ? `${report.inserted.length} added`     : null,
              report.removed.length   ? `${report.removed.length} removed`    : null,
            ].filter(Boolean).join(", ")
          : `${out.length} recipes`;

        const ghRes = await fetch(apiUrl, {
          method: "PUT",
          headers: { ...ghHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Update recipes.json — ${summary} (${safeLabel(label)})`,
            content: contentB64,
            sha: currentFile.sha,
          }),
        });

        if (ghRes.ok) {
          const done = await ghRes.json();
          return jsonResponse({
            ok: true,
            count: out.length,
            commit: done.commit && done.commit.sha,
            attempts: attempt,
            ...(report || {}),
          });
        }

        // 409 = someone else's write landed between our read and our write.
        // 422 can also mean a stale sha. Both are worth retrying.
        if (ghRes.status === 409 || ghRes.status === 422) {
          lastErr = await ghRes.text();
          continue;
        }

        const text = await ghRes.text();
        return jsonResponse({ error: `GitHub error ${ghRes.status}`, detail: text }, 502);
      }

      return jsonResponse({
        error: "Could not save — the file kept changing while saving. Try again.",
        detail: lastErr,
      }, 409);
    }

    // ── Prep Hub proxy ─────────────────────────────────────────────────────
    // The browser calls /prep/<path>; we re-authenticate the user here and
    // forward to the Prep Hub with a service key the browser never sees.
    //
    // The store scope comes from the LOGIN, not from the request. A store login
    // physically cannot ask for another store's prep data — the code isn't
    // taken from anything the client can set. The all-stores admin may name a
    // store, but only one of the nine known codes.
    if (url.pathname === "/prep" || url.pathname.startsWith("/prep/")) {
      if (!env.PREP_HUB_KEY) {
        return jsonResponse({ error: "Prep Hub is not configured on this Worker" }, 503);
      }
      const me = authenticatedUser(request, env);
      if (!me) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json",
                     "WWW-Authenticate": 'Basic realm="Crabby\'s Recipe Hub"' },
        });
      }

      let storeCode = me.code || "";
      if (!storeCode) {
        // All-stores admin: may pick, but only from the known set.
        const asked = url.searchParams.get("store") || "";
        if (!PREP_STORE_CODES.includes(asked)) {
          return jsonResponse({ error: "Unknown or inactive store" }, 403);
        }
        storeCode = asked;
      }

      const rest = url.pathname.replace(/^\/prep\/?/, "");
      if (!PREP_PATHS.some(re => re.test(rest))) {
        // Distinct wording: the Prep Hub also answers {"error":"Not found"},
        // and without this you cannot tell which side rejected the call.
        return jsonResponse({ error: `Not allowed by the Recipe Hub proxy: ${rest}` }, 404);
      }

      const target = new URL(`${PREP_HUB_BASE}/api/stores/${encodeURIComponent(storeCode)}/${rest}`);
      // Forward only the query params the Prep Hub uses; "store" is ours.
      for (const [k, v] of url.searchParams) {
        if (k !== "store") target.searchParams.set(k, v);
      }

      const init = {
        method: request.method,
        headers: {
          "X-BSHG-Key": env.PREP_HUB_KEY,
          "X-BSHG-Store": storeCode,
          // Every Recipe Hub login is treated as a manager: our logins carry no
          // role, and staff would be blocked from finishing or reopening a day.
          "X-BSHG-Role": env.PREP_HUB_ROLE || "manager",
          "Content-Type": "application/json",
          "User-Agent": "crabbys-recipe-hub-worker",
        },
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = await request.text();
      }

      let res;
      try {
        res = await fetch(target.toString(), init);
      } catch (e) {
        return jsonResponse({ error: "Could not reach the Prep Hub", detail: String(e) }, 502);
      }
      // Pass the status straight through: 409 is the two-phase gate and the
      // page needs to see it, not a flattened error.
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Image upload: commits a photo into the GitHub Pages repo and
    // returns a permanent public URL to store in the recipe's data. ──
    if (url.pathname === "/upload" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: "Invalid request body" }, 400);
      }

      const label = matchEditPassword(env, body.password);
      if (!label) {
        return jsonResponse({ error: "Incorrect password" }, 401);
      }
      if (!body.dataBase64 || !body.filename) {
        return jsonResponse({ error: "Missing image data or filename" }, 400);
      }

      // Sanitize filename and make it unique to avoid collisions
      const ext = (body.filename.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const path = `images/${uid}.${ext}`;

      const ghRes = await fetch(
        `https://api.github.com/repos/${env.GH_REPO_OWNER}/${env.GH_REPO_NAME}/contents/${path}`,
        {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "crabbys-recipe-hub-worker",
          },
          body: JSON.stringify({
            message: `Upload recipe image ${path} (${safeLabel(label)})`,
            content: body.dataBase64,
          }),
        }
      );

      if (!ghRes.ok) {
        const text = await ghRes.text();
        return jsonResponse({ error: `GitHub error ${ghRes.status}`, detail: text }, 502);
      }

      const publicUrl = `https://raw.githubusercontent.com/${env.GH_REPO_OWNER}/${env.GH_REPO_NAME}/main/${path}`;
      return jsonResponse({ ok: true, url: publicUrl });
    }

    // ── Everything else: gate the whole site behind HTTP Basic Auth,
    // then proxy through to the actual GitHub Pages content, injecting
    // which store (if any) this specific user is restricted to. ──
    if (request.method === "GET") {
      const authHeader = request.headers.get("Authorization");
      let users;
      try { users = JSON.parse(env.USERS_JSON); } catch(e) { users = {}; }

      let matchedUser = null;
      if (authHeader && authHeader.startsWith("Basic ")) {
        const decoded = atob(authHeader.slice(6));
        const sepIdx = decoded.indexOf(":");
        const user = decoded.slice(0, sepIdx);
        const pass = decoded.slice(sepIdx + 1);
        if (users[user] && users[user].password === pass) {
          matchedUser = users[user];
        }
      }

      if (!matchedUser) {
        return new Response("Authentication required", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Crabby\'s Recipe Hub"' },
        });
      }

      const originUrl = ORIGIN_BASE + (url.pathname === "/" ? "/" : url.pathname);
      const originRes = await fetch(originUrl, { cf: { cacheTtl: 0 } });
      let body = await originRes.text();

      // Tell the page which store (if any) this user is locked to. Escape
      // single quotes so location names like "Salty's Island" don't break
      // out of the single-quoted JS string literal they're substituted into.
      // "location" is the RECIPE BOOK (CBG, CDS, Palm, ...). Several physical
      // stores share one book, so "store" carries the individual site name.
      // The page filters by the book and displays the store.
      const assignedLocation = matchedUser.location || "all";
      const assignedStore = matchedUser.store || assignedLocation;
      // "code" is the STABLE per-store key, shared verbatim with the Prep Hub
      // (csc-stcloud, cbg-nsb, ...). Display names can be renamed freely; this
      // is what per-store data keys off, so it must never change.
      const assignedStoreCode = matchedUser.code || "";
      // Escape single quotes: these get substituted into single-quoted JS
      // string literals, and names like "Salty's Island" or "Crabby's on the
      // Lakefront" would otherwise break out and kill the whole script.
      const esc = v => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      body = body.replace("ASSIGNED_LOCATION_PLACEHOLDER", esc(assignedLocation));
      body = body.replace("ASSIGNED_STORE_PLACEHOLDER", esc(assignedStore));
      body = body.replace("ASSIGNED_STORE_CODE_PLACEHOLDER", esc(assignedStoreCode));

      return new Response(body, {
        status: originRes.status,
        headers: {
          "Content-Type": originRes.headers.get("Content-Type") || "text/html; charset=UTF-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
        },
      });
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};

// Keep a label safe to drop into a one-line git commit message.
function safeLabel(label) {
  return String(label).replace(/[\r\n]+/g, " ").trim().slice(0, 40) || "unknown";
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
