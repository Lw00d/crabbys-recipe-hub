# Beachside Recipe Hub — Handoff

Paste this whole document as your first message in a new chat to resume.
As of this writing: **1,688 recipes**, latest commit `b583724825`.

**Everything is now in the repo.** `worker.js`, the 173-test suite and this
document all live in git. A new session can rebuild full context from a
checkout — it does not need a chat transcript.

This supersedes all earlier handoff docs. The architecture changed
substantially on 2026-09-10 — the save path, the Worker, and the read method
are all different from what previous handoffs described. **Do not follow an
older handoff's workflow section.**

---

## Access & credentials

| What | Value |
|---|---|
| GitHub repo | `Lw00d/crabbys-recipe-hub` |
| App file | `index.html` at repo root |
| Data file | `data/recipes.json` (~2.1 MB) |
| Images | `images/` in the same repo |
| Worker source | `worker.js` — **in the repo**; edit there and paste into Cloudflare |
| Prep Hub API | `https://bshg-prep-hub.bshgrp.workers.dev` (Jon's system) |
| Worker URL (staff-facing) | `recipes.jbodzak.workers.dev` |
| GitHub Pages origin | `https://lw00d.github.io/crabbys-recipe-hub` |
| GitHub PAT | **not recorded here — see below** |

**On secrets.** Earlier handoffs pasted the PAT, the edit password and every
store login directly into the document. That put live credentials into every
chat transcript the doc was ever pasted into. Don't do that again. Paste the
PAT into the chat only when work actually needs it, and keep it out of any
file. **The PAT that was in the previous handoff still needs rotating** —
it has been exposed in multiple transcripts.

Cloudflare config (values not recorded here): `EDIT_PASSWORDS`,
`GITHUB_TOKEN`, `GH_REPO_OWNER`, `GH_REPO_NAME`, `USERS_JSON`, `PREP_HUB_KEY`.
Legacy `EDIT_PASSWORD` is ignored once `EDIT_PASSWORDS` is set.

**These are currently plain Variables, not encrypted Secrets** — their values
are readable in the dashboard and would land in `wrangler.jsonc` if anyone
accepts Cloudflare's "keep deployments in sync" prompt. Re-add each as a
Secret. `PREP_HUB_KEY` was also visible in a screenshot and should be rotated
with Jon; the value only has to match on both sides, the variable names differ
(`PREP_HUB_KEY` here, `RECIPE_HUB_SHARED_SECRET` on his).

Logins live in `USERS_JSON`. See "Stores vs recipe books" below — there are
now nine store logins plus an all-stores admin. Only BSHGRP has data today;
BSHGRP2 (Mar Vista, Sandbar, Beach House) exists in the code but has no
recipes.

---

## Stores vs recipe books — **important model change**

Nine physical stores share **five recipe books**. A recipe's `location` field
means the **book**, not the store. Do not add store names to recipe data.

| Store code | Site | Book (`location`) |
|---|---|---|
| `stcloud` | Crabby's on the Lakefront — St. Cloud | `CBG` |
| `newsmyrna` | Crabby's Bar & Grill — New Smyrna Beach | `CBG` |
| `staugustine` | Crabby's Beachside — Saint Augustine | `CBG` |
| `clearwaterbeach` | Crabby's Bar & Grill — Clearwater Beach | `CBG` |
| `dockside` | Crabby's Dockside — Clearwater | `CDS` |
| `oceanside` | Crabby's Oceanside — Daytona Beach | `CDS` |
| `saltysisland` | Salty's Island | `Salty's Island` |
| `northbeach` | Salty Crab North Beach | `Salty Crab North Beach` |
| `pavilion` | Crabby's Beachside at the Pavilion | `Palm` |

Each `USERS_JSON` entry is `{password, location, store}` — `location` is the
book (drives filtering, unchanged behaviour), `store` is the site name shown
in the header. `store` is optional and falls back to the book name.

The Worker substitutes both `ASSIGNED_LOCATION_PLACEHOLDER` and
`ASSIGNED_STORE_PLACEHOLDER`. The page filters by book and displays the store,
appending the book in faded text only when it isn't already implied by the
store name.

**No recipe data changed for this.** One edit to a CBG recipe still serves all
four CBG stores.

**Five of the nine store names contain an apostrophe and two contain an
ampersand.** They get substituted into single-quoted JS string literals. An
unescaped apostrophe in "Salty's Island" once killed the entire script. The
escape handles backslashes and single quotes, and `store_split.test.mjs`
substitutes every one of the nine and then *parses the result as JavaScript*.
Keep that test if the names ever change.

**Prep and yield sheets are coming**, built by a colleague, to be added later.
They should key off the **store code**, not the display name — renaming a site
shouldn't orphan its rows. Recipes stay keyed to the book. Note the merge-save
endpoint is hardcoded to `recipes.json`; a second data file needs a
generalised endpoint taking a path, not a copy-pasted handler. Also decide
whether a per-store yield **overrides** the recipe's existing `yield` field or
is a separate measurement — two sources of truth for one number will drift.

The old usernames (`cds`, `cbg`, `palm`, `si`, `scnb`) no longer exist. Devices
with them saved in Safari will fail to authenticate; add aliases pointing at
the same book if that bites.

---

## Prep Hub integration — LIVE

Jon's BSHG Prep Hub (Cloudflare Worker + D1) handles prep sheets, daily
counting, par suggestions and yield tests. The Recipe Hub now drives it, so
staff use one app.

**Architecture: one app, two engines.** Recipes stay in git where version
history and the merge saves matter. Counts stay in D1 where transactional
state belongs. The Recipe Hub Worker proxies between them.

### How the proxy works

The browser calls `/prep/<path>` on our Worker. We re-verify the Basic Auth
credentials against `USERS_JSON`, take the store code **from the login**, and
forward to the Prep Hub with `X-BSHG-Key` (the shared secret), `X-BSHG-Store`
and `X-BSHG-Role`. The key never reaches a browser.

**The store scope is structural, not a UI convention.** It is read from the
authenticated user and never from anything the client can set, so a store
login physically cannot request another store's data. The all-stores admin may
name a store, but only one of the nine. Paths are allowlisted, not passed
through. All of this is covered by `tests/prep_proxy.test.mjs`.

### The endpoints (the id is a PATH segment, never a body field)

- On-hand: `PUT /api/stores/{store}/prep-items/{itemId}/count` —
  body `date, on_hand_qty, usage_qty, counted_by, par_mode`
- Prepped: `PUT .../prep-items/{itemId}/count/complete` —
  body `date, prepped_qty, completed_by`
- Yield test: `POST .../yield-items/{itemId}/tests` —
  body `test_date, raw_qty, portions[{prep_item_id, portions_qty}], tested_by`
- Day: `PUT .../prep-days/{date}/start|finish|reopen` — body `started_by` /
  `completed_by` / `reopened_by`
- Reads: `GET .../prep-items`, `GET .../prep-days/{date}/status`

**Request bodies are snake_case; responses are camelCase.** Do not assume one
from the other.

**There is no "finish the counting phase" call.** `/count/complete` is the
prepped amount for one item. The Prep Hub derives `countingComplete` once every
item has a count.

**The par basis rides on the count call.** `par_mode` shares a body with
`on_hand_qty`, so sending it alone blanks the count. It is held locally and
sent with the next count; changing it on a counted item re-sends the number.

### Errors

Every error is `{"error": "..."}`. 401 bad key, 400 missing store or actor
name, 403 unknown store / wrong store / wrong tier, **409 is the two-phase
gate** — treat it as a state signal and re-render, not as a failure.

### Prep sheets are per STORE, recipes are per BOOK

Nine separate prep sheets. Four stores share the CBG book but have 62, 69, 54
and 60 items with different pars — Calamari is 24 / 6 / 13 across three of
them, and its pull/thaw flag differs too. Never flatten a prep sheet to a book.

### Roles — a known gap

Every Recipe Hub login is sent as `manager`, because our logins carry no role.
Prep Hub restricts **finish** and **reopen** to managers, so today every store
login can do both. The intended model is store logins counting in the Recipe
Hub and managers using Prep Hub directly. Closing the gap means adding a
`role` field to `USERS_JSON`, sending it instead of the hardcoded value, and
hiding those buttons for staff. Deliberately deferred.

### Linking the two datasets

`data/prep-links.json` maps a Prep Hub `prep_item` id to the Recipe Hub recipe
id for that store's book — **230 of 559** items. Keyed per item, not per Prep
Hub recipe, because a Prep Hub recipe is shared across up to 9 stores spanning
up to 5 books, and those books sometimes hold genuinely different recipes
(`Pasta Linguine` is Scampi at CBG/CDS/NB and Olive Oil at Palm/SI; `Onion` is
Onion Rings at CBG and Onion Straws at CDS). Per-item resolves unambiguously.

329 items remain unlinked. Jon classified 117 of them: 51 are raw or portioned
proteins that were never recipes, 26 match in another book, and **about 40
genuinely need a human eye**.

### Deep links

`?master=<masterId>` opens whichever row belongs to **the viewer's own book** —
one URL works for all nine stores. `?recipe=<id>` opens one exact row. Both are
gated so a store cannot reach another book.

---

## Read/write workflow — **CHANGED, read this carefully**

### Reading

**Use the Git blob API, not the Contents API.**

```
1. GET /repos/Lw00d/crabbys-recipe-hub/contents/data/recipes.json
   Accept: application/vnd.github+json      -> gives you `sha` and `git_url`
2. GET that git_url  (i.e. /git/blobs/<sha>)
   Accept: application/vnd.github.v3.raw    -> gives you the actual JSON text
```

The Contents API **silently returns `encoding: "none"` and an empty
`content` field for files over ~1 MB**. recipes.json is 2.1 MB, so it always
comes back empty. This caused a live 500 on 2026-09-10. Fetching the blob by
the same sha you'll write against is both size-safe and atomic.

Never use `atob()` on the base64 — it returns one character per byte and
mangles every `°F`, `—` and accented character into mojibake. The raw media
type gives properly decoded UTF-8.

`raw.githubusercontent.com` is still off-limits (CDN lag).

### Writing

- Re-fetch immediately before the `PUT` and diff against what you built on.
- Only the recipes you're changing need to be unchanged; other people's edits
  elsewhere are fine and must be preserved.
- Assert that the diff set is exactly your intended set before pushing.
- Re-read after pushing and confirm the live file matches what you tested.
- `json.dumps(..., indent=2, ensure_ascii=False)` round-trips byte-identically
  against the stored file — verified.

### index.html and worker.js changes

Every change gets **both**: a `new Function(scriptContent)` syntax check **and**
a functional test exercising the actual behaviour. This is a hard rule and it
has caught real bugs repeatedly.

```
npm install jsdom
node tests/run-all.mjs
```

173 tests across ten suites, all reading the real `index.html` and `worker.js`
rather than copies. `tests/README.md` lists what each covers and why it exists.

**Run the tests and push as separate steps.** Chaining them with `&&` let a
failing suite through twice in one session, because the last command in the
chain succeeded.

---

## Architecture as it stands now

### Saving is a merge, not an overwrite

Previously every save sent the **entire 1,684-recipe array** and overwrote the
file. Two people editing at once meant one lost everything.

Now the page sends only `changed` (each with the version it loaded as `base`)
and `deleted` (ids with their base). The Worker reads the current file, applies
those recipes by id, and writes back — retrying up to 4 times on a 409 if
someone's write lands mid-flight. Untouched recipes are never rewritten from a
stale copy.

- **Policy is last-writer-wins** on the same recipe, chosen deliberately. The
  save always lands, but overwritten ids come back in `overwrote` and the user
  is told which recipe they stepped on.
- After a successful save the page waits until the server reflects its own
  changes, then silently adopts the current file, so other people's edits
  appear automatically.
- Deletions are sent explicitly. Inferring them from absence would let a stale
  tab delete recipes someone else added.
- The Worker still accepts the old whole-array format, so a stale cached page
  keeps working — but that path can still clobber. Make sure iPads get a real
  hard refresh.
- `stable()` in the Worker and `stableStr()` in index.html **must stay
  byte-identical**. Object keys are sorted; array order is deliberately NOT
  normalised, because reordering steps or photos is a real edit. Verified
  against all 1,684 recipes.

### Worker (`worker.js`)

Not in the repo — it exists only in Cloudflare. **Worth committing** (it holds
no secrets, only `env.*` references). Current features:

- `EDIT_PASSWORDS`: a JSON object of label → password. Any one unlocks editing.
  Revoke by deleting the entry. The label goes into the commit message, so
  history now reads `Update recipes.json — 1 edited (Tim)`.
- Merge save with retry (above).
- Refuses to write an empty recipe list.
- Reads via the blob API.

### index.html features added

- **🔗 Link to These Filters** button beside 🗄 Inactive — writes current
  filters into the address bar and copies to clipboard. Omits `loc=`/`group=`
  for single-store logins.
- **◀ ▶ photo reorder arrows** on each thumbnail (2+ photos). Replaced a
  drag-to-reorder version that was too fiddly on a touchscreen.
- URL filter params (`?cat=` `?sub=` `?loc=` `?group=`) from an earlier session
  still work; the Link button is the easy way to build them.

---

## The grilling SOP rollout — COMPLETE

Source document: `Seasoning_and_Griling.docx`. **158 recipes** updated across
eleven batches on 2026-09-09/10, each previewed as a before/after HTML diff and
approved before pushing.

### The canonical blocks (reuse these verbatim)

**Fish**
```
Pat the {Protein} dry.
Season the non-skin side only with the requested seasoning, before it touches the grill.
Spray the flat top, then lay the fish seasoned side down.
A light weight may be used — never press, smash, or dome.
Let the sear set, longer than 60 to 90 seconds. Flip only when the edges begin turning white.
Move to the cooler zone of the flat top.
Drizzle and brush with pre-melted lemon butter several times until glossy — never let it scorch.
```

**Chicken, flat top** — as above but `Season the skin side only …`, `lay the
chicken skin (smooth) side down`, no "Pat dry" line.

**Chicken, char grill** — season skin side only, no butter on the char grill,
skin side down, `Rotate 10 → 2 to set the diamond marks.`, flip on the white
edge cue, finish on the cooler flat top with lemon butter.

**Steak, char grill**
```
Generously season both sides with requested seasoning.
Place on the hot zone of the char grill.
Rotate 10 → 2 to set the diamond marks.
Flip and repeat 10 → 2 so there are full diamonds on both sides.
A light weight may be used — never press, smash, or dome.
Cook to the requested temperature.
Finish on the cooler zone of the flat top, drizzled and brushed with pre-melted lemon butter.
```

**Shrimp**
```
Season one side only with the requested seasoning, before it touches the grill.
Spray the flat top, then lay the skewers seasoned side down.
Cook quickly — flip when the edges begin turning white.
Continue cooking until the shrimp are thoroughly cooked and no longer translucent.
Move to the cooler zone and finish with a light brush of pre-melted lemon butter.
```

**Flat-top burger** — season both sides, spray, place seasoned side down,
light weight but never press, flip on the white edge cue, finish with
pre-melted lemon butter on the cooler zone.

### Rules applied throughout

- Section headers standardised to `GRILLED / BLACKENED:`, `CHAR GRILL:`,
  `FRIED:`, `BROILED:`, `ASSEMBLY:`. A line ending in a colon renders without a
  step number. Protein prefixes kept where a recipe has more than one protein
  (`Grouper - GRILLED / BLACKENED:`).
- `Lemon Butter` added to ingredients wherever the finish was added.
  `Garlic Spread` removed **only** where nothing else in the recipe still uses
  it — broiled sections still use it and must keep it.
- `Old Bay` → `Requested Seasoning` **in BROILED sections only**. The other
  ~180 Old Bay references (crab boil water, Bairdi coating, parmesan oysters,
  crab cakes) are genuinely Old Bay and were left alone.
- Portioning, plating, expo and plateware lines are always preserved.
- Recipes finishing on another sauce **do not** get lemon butter: teriyaki
  chicken, honey-mustard shrimp and Key West plates, salsa verde, honey fig
  salmon. Cajun Butter kept on the Cajun ribeyes by explicit decision.
- Food-safety lines preserved: Turkey Burger keeps "cook all the way through to
  165°F"; the white-edge cue tells you the sear has set, not that poultry is safe.
- Black Bean Burger: keeps its "olive oil (not pan spray)" exception and gets
  **no lemon butter** — it's the vegetarian option.

### Explicitly excluded

Crab and crab cakes (user's decision), all Bairdi / fire-roasted crab, lobster
tails (broiled, no SOP section), and anything fried, baked or steamed.

---

## Section headers — COMPLETE

`Expo:`, `Plateware:`, `Garnish:` and `Glassware:` are now bare headers with
their content as the following step, hub-wide: 508 / 557 / 312 / 244 headers,
zero glued labels remaining. 748 recipes, 1,132 lines split, content verified
byte-identical.

Four recipes (`Red Fish & Grits` and `Trigger Fish`, CBG + CDS pairs) had
**multi-line steps with embedded tabs**, pasted from a document. They rendered
as a handful of giant blobs and, critically, **hid content from every
content sweep** — `Red Fish & Grits` still had the old grilling method buried
inside one. Both are rebuilt. There are now **zero multi-line steps and zero
tabs** anywhere in the data. Worth re-checking periodically: a one-line scan
for `\n` or `\t` inside a step catches it.

---

## Bugs found and fixed this session — worth not repeating

1. **Contents API >1 MB returns empty content.** Caused a live 500. Use the
   blob API. My test's fake GitHub returned populated content at every size,
   so the tests passed while production failed — **make fakes mirror the real
   API's limits, not its happy path.**
2. **`atob()` mangles UTF-8.** Would have silently corrupted every `450°F` in
   the file on the first merge save.
3. **Matching step lines by text, not index.** `Brush with garlic spread to
   moisten before plating.` appears in both the grilled and broiled sections of
   several recipes. Text matching consumed both and gutted the broiled method.
   **Always match on position.**
4. **Method labels block `^`-anchored patterns.** `Grilled/Blackened: Baste
   grouper with…` never matched, so the old line survived above the new block.
   Strip the label before testing.
5. **`filet` matches Filet Mignon.** Nearly applied the fish block to beef.
6. **Technique isn't protein-specific.** "Rotate 45 degrees" and "diamond
   marks" appear on chicken too — ten chicken recipes nearly received the steak
   block, which would have told cooks to season chicken on both sides.
7. **Cross-realm arrays in jsdom.** `deepStrictEqual` compares prototypes;
   spread into the test realm first.
8. **Regenerating from source wipes hand-edits.** Fold every review adjustment
   into the transform script rather than patching the output JSON.
9. **A placeholder must appear exactly once.** The Worker replaces the FIRST
   occurrence. A guard that compared the placeholder against itself consumed
   the substitution and left the constant holding the placeholder text.
10. **`esc()` throws on a number** — it is `(s||'').replace(...)`. The Prep Hub
    returns real numbers where the old snapshot returned strings, so anything
    from an API goes through `pnum()` / `ptxt()` first.
11. **`const` declared after its first use** kills a whole render via the
    temporal dead zone, and looks identical to a hung network call.
12. **Two bad pastes of the same JSON.** Retyping a verified file by hand
    corrupted one password twice. Print the file, never retype it.

---

## Active constraints

- Never link recipes across locations unless content is genuinely identical.
- `active: false` to hide a recipe; never delete when that would do.
- BSHGRP / BSHGRP2 are fully independent — no cross-group browsing, filtering
  or master-linking, even on a `masterId` collision.
- Deep-clone anything that creates a new recipe object from an existing one.
  Shallow copies caused a bidirectional-editing bug once already.
- Diff-check before starting and immediately before pushing, every time. Two
  people (Tim and Kory/bodzak) edit concurrently and both were active
  throughout this session.
- When mismatches are found in linked groups, flag for human review rather than
  auto-merging or auto-unlinking.

---

## Open tasks

### Prep Hub follow-ups

0. **Yield tests are not built.** The endpoint is allowlisted and the body
   shape is known — UI work only.
1. **Roles** — see the gap above.
2. **~40 unlinked prep items** need a human decision.

### Blocked on you / the SOP

1. **Char Grill Method for sirloin burgers.** SOP §8 says *"(Steps to be
   added.)"*. Four recipes waiting: `Sirloin Burger (All Stores)` (CBG + NB,
   linked), `Palm (Sirloin) Burger`, `Backyard Burger`.
2. **Scallops — 7 recipes, no SOP section.** They sear on *both* flat sides,
   which none of the existing rules cover. Currently untouched by design.
3. **Do smash burgers finish with lemon butter?** §7 doesn't say; the universal
   rule says always. `Smash Burgers` (CBG) currently has none.
4. **Five kid burgers** deliberately skipped — currently two lines each
   ("Place the burger on the grill. Turn over halfway"). Decide whether they
   should get the full technique.

### Security / hygiene

5. **Rotate the GitHub PAT.** Outstanding all session; exposed in multiple
   transcripts.
6. **Commit `worker.js` to the repo.** It exists in exactly one place with no
   version history.
7. **`drm-nb-45` was hard-deleted** rather than set `active: false`, against
   convention. Recoverable from git history if unintended.

### Data quality

8. **46 linked groups are internally divergent** (out of 358). The old
   `Beachside_Linked_Recipe_Mismatches.xlsx` is stale — regenerate before
   acting. Every fish group opened this session turned out divergent, and the
   fix was the same shape each time: normalise wording, standardise headers,
   pick one Expo line. Worth one systematic sweep rather than discovering them
   group by group. `Grouper Sandwich` (4 stores) and `Grouper Dinner` are done.
9. **"Wrong protein" scan.** `Bairdi (3/4#) & Shrimp` referenced ribs
   throughout because it was copied from a ribs plate. Scan for recipes
   mentioning a protein absent from their ingredients.
10. **`Lightly season chicken with steak seasoning`** — one recipe. Deliberate
    or copy-paste?
11. **`Honey Fig Salmon`** lists `Old bay` in ingredients but its step now says
    requested seasoning.
12. **Clear filters doesn't reset the address bar** — if someone clicks the
    Link button then clears filters, a pin at that moment captures stale
    filters.
13. **`loc=` gap for single-store logins.** In `applyFiltersFromUrl()`, a
    store login opening `?loc=Mar Vista` would see it, crossing the
    BSHGRP/BSHGRP2 boundary. The Link button sidesteps this by never emitting
    `loc=` for those logins, but the reader is still permissive. Three-line fix.

### Older threads, untouched all session

14. **Drink batch-size project**: Palm ✅, North Beach ✅. CBG, CDS, Salty's
    Island still not sent. Also unresolved: the Miami Vice rum-brand mismatch
    ("Planteray Dark Rum" saved vs "Cruzan 137 Rum" in the newer doc).
15. **Brussels Sprouts overlap at Salty's Island** — `Brussels Sprouts
    (Appetizer)` vs `Brussels Sprout Side`. Never got a yes/no.
16. **Spanish translation — paused.** Bilingual-in-place schema (`name_es`,
    `steps_es[]`, per-ingredient `name_es`) so `masterId` propagation keeps
    working; language toggle in the UI; batches by location + category; a
    fluent speaker spot-checks before it goes on the line. **Still unanswered:
    which Spanish variant** (neutral/Latin American, Mexican, Caribbean).
17. **Periodic duplicate/mislabel scan** — group by location+category+submenu+
    name, diff content, check ID prefix vs location field. Not re-run in a long
    while.

---

## How to work on this effectively

The pattern that worked, eleven times running:

1. Sweep the data for the pattern, and **show the counts and the distinct
   variants before proposing anything**. The variety is always larger than
   expected — 30 spellings of one header, 16 spellings of one finishing line.
2. Separate what's genuinely in scope from what merely matches. Most sweeps
   catch two to three times more than they should.
3. Build a transform with **explicit per-recipe line indices** where possible,
   or careful patterns plus a content-loss detector that flags any consumed
   line carrying non-procedure text.
4. Generate a before/after HTML preview, green for added and red for removed,
   both steps and ingredients. **Push nothing until it's approved.**
5. Apply with a fresh fetch, a drift check on the targets only, an assertion
   that the diff set is exactly the intended set, then verify against live.

Batch by protein rather than by store — linking means one edit often covers
three stores, and grouping keeps linked siblings together.
