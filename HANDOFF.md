# Beachside Recipe Hub — Handoff

Paste this whole document as your first message in a new chat to resume.
As of this writing: **2,039 recipes** across **two companies**, latest commit
`e5bed3c`.

**Everything is in the repo.** `index.html`, `worker.js`, `data/recipes.json`,
the 216-test suite and this document all live in git. A new session can rebuild
full context from a checkout — it does not need a chat transcript.

The suite runs from a clean clone: `npm install jsdom && node tests/run-all.mjs`,
nothing else, no fixture files to find. If a suite ever reports CRASHED rather
than a pass count, treat that as a failure — `run-all.mjs` does, but the line is
easy to skim past next to nine lines of green.

**Two companies, deliberately separate.** BSHGRP (1,688 recipes, five books)
and BSHGRP2 (351 recipes, three books). `LOC_GROUP` in `index.html` keeps them
apart structurally: a masterId in one cannot reach a row in the other, even if
the ids collided. They do not share recipes, submenu vocabulary, or naming
conventions, and a convention from one is not evidence for the other.

This supersedes all earlier handoff docs. **Do not follow an older handoff's
workflow section** — the save path, the Worker and the read method all changed
on 2026-09-10.

---

## Access & credentials

| What | Value |
|---|---|
| GitHub repo | `Lw00d/crabbys-recipe-hub` |
| App file | `index.html` at repo root |
| Data file | `data/recipes.json` (~2.6 MB, 2,039 recipes) |
| Images | `images/` in the same repo |
| Worker source | `worker.js` — **in the repo**; edit there and paste into Cloudflare |
| Prep Hub API | `https://bshg-prep-hub.bshgrp.workers.dev` (Jon's system) |
| Worker URL (staff-facing) | `recipes.jbodzak.workers.dev` |
| GitHub Pages origin | `https://lw00d.github.io/crabbys-recipe-hub` |
| GitHub PAT | **not recorded here — see below** |

**On secrets.** Earlier handoffs pasted the PAT, the edit password and every
store login directly into the document. The same values also reached a test
fixture that was read from disk at runtime (see bug 15). That put live credentials into every
chat transcript the doc was ever pasted into. Don't do that again. Paste the
PAT into the chat only when work actually needs it, and keep it out of any
file. Tokens were rotated on 2026-09-17 and again during the 2026-09-18 session;
**every token used in a chat should be revoked when that chat ends.** A
fine-grained token scoped to this one repo with Contents: read and write is all
any session needs — never a classic `repo`-scoped one.

Cloudflare config (values not recorded here): `EDIT_PASSWORDS`,
`GITHUB_TOKEN`, `GH_REPO_OWNER`, `GH_REPO_NAME`, `USERS_JSON`, `PREP_HUB_KEY`,
`PREP_HUB_ROLE`. Legacy `EDIT_PASSWORD` is ignored once `EDIT_PASSWORDS` is
set. `PREP_HUB_ROLE` is optional and defaults to `manager` — see "Roles" below;
it is the one lever that changes what the proxy claims every login is.

**These are currently plain Variables, not encrypted Secrets** — their values
are readable in the dashboard and would land in `wrangler.jsonc` if anyone
accepts Cloudflare's "keep deployments in sync" prompt. Re-add each as a
Secret. `PREP_HUB_KEY` was also visible in a screenshot and should be rotated
with Jon; the value only has to match on both sides, the variable names differ
(`PREP_HUB_KEY` here, `RECIPE_HUB_SHARED_SECRET` on his).

Logins live in `USERS_JSON`. See "Stores vs recipe books" below — twelve store
logins plus an all-stores admin. Both companies have recipes, and prep sheets
work for all twelve stores: verified end to end on 2026-09-18 by logging in as
`sandbar`, seeing its 104 recipes, and loading a live prep sheet with items.

---

## Stores vs recipe books

**Twelve stores, eight books, two companies.** A recipe's `location` field
means the **book**, not the store. Do not add store names to recipe data.

BSHGRP's nine stores share five books — four CBG sites read one book. BSHGRP2's
three stores have one book each, so store and book happen to coincide there;
that is a coincidence of the current layout, not a rule to build on.

**Three different identifiers, and they are not interchangeable.** The login
name, the store code shared with the Prep Hub, and the book. An earlier version
of this table had one column headed "Store code" holding login names, which is
how a session once assumed the Clearwater Beach login was `clearwaterbeach`.
It is `beachwalk`.

| Login | Prep code (`code`) | Site (`store`) | Book (`location`) |
|---|---|---|---|
| `stcloud` | `csc-stcloud` | Crabby's on the Lakefront — St. Cloud | `CBG` |
| `newsmyrna` | `cbg-nsb` | Crabby's Bar & Grill — New Smyrna Beach | `CBG` |
| `staugustine` | `cbp-staugustine` | Crabby's Beachside — Saint Augustine | `CBG` |
| `beachwalk` | `cbg-beachwalk` | Crabby's Bar & Grill — Clearwater Beach | `CBG` |
| `dockside` | `cds-dockside` | Crabby's Dockside — Clearwater | `CDS` |
| `oceanside` | `cds-oceanside` | Crabby's Oceanside — Daytona Beach | `CDS` |
| `saltysisland` | `si-island` | Salty's Island | `Salty's Island` |
| `northbeach` | `nb-crab` | Salty Crab North Beach | `Salty Crab North Beach` |
| `pavilion` | `cbp-pavilion` | Crabby's Beachside at the Pavilion | `Palm` |
| `marvista` | `mv-dockside` | Mar Vista | `Mar Vista` |
| `sandbar` | `sb-seafood` | Sandbar | `Sandbar` |
| `beachhouse` | `bh-waterfront` | Beach House | `Beach House` |

**The code is never yours to choose.** It is the Prep Hub's own id. On
2026-09-18 a session invented all three BSHGRP2 codes (`mv-marvista`,
`sb-sandbar`, `bh-beachhouse`) and every one was wrong — the real ids are
`mv-dockside`, `sb-seafood` and `bh-waterfront`, confirmed against live
production. They were caught before anything was deployed.

**Two of the three correct codes were already in this repo**, sitting in
`prep_proxy.test.mjs` as examples of deferred stores, from an earlier session.
A grep would have found them. Search the repo before inventing an identifier.

Note the Prep Hub's store names differ from the recipe books: Mar Vista
Dockside, The Sandbar, The Beach House — Waterfront. The `store` field still
holds the shorter names the app displays.

The `admin` login has `location: "all"` and no `code` — it must name a store on
every Prep Hub call, and only one of the codes in `PREP_STORE_CODES`. Those
codes are hardcoded in `worker.js` and duplicated in the `prep_proxy` test
fixture; change one and you must change both.

**All twelve store logins share one password.** One leak is twelve stores.
Changing them means someone re-entering credentials on every iPad, since Safari
has them saved — worth planning rather than doing on a Friday.

Each `USERS_JSON` entry is `{password, location, store, code}` — `location` is
the book (drives filtering, unchanged behaviour), `store` is the site name shown
in the header, and `code` is the stable per-store key the Prep Hub knows the
site by. `store` is optional and falls back to the book name. `code` is what all
per-store data keys off, so it must never be changed once it is in use — the
display name can be changed freely, which is the whole point of having both.

The Worker substitutes three placeholders: `ASSIGNED_LOCATION_PLACEHOLDER`,
`ASSIGNED_STORE_PLACEHOLDER` and `ASSIGNED_STORE_CODE_PLACEHOLDER`. The page
filters by book, displays the store — appending the book in faded text only
when it isn't already implied by the store name — and sends the code to the
Prep Hub. Each must appear exactly once in `index.html`; see bug 9 below.

**No recipe data changed for this.** One edit to a CBG recipe still serves all
four CBG stores.

**Five store names contain an apostrophe and two contain an ampersand.** They get substituted into single-quoted JS string literals. An
unescaped apostrophe in "Salty's Island" once killed the entire script. The
escape handles backslashes and single quotes, and `store_split.test.mjs`
substitutes every one of them and then *parses the result as JavaScript*.
Keep that test if the names ever change.

Note the merge-save endpoint is hardcoded to `recipes.json`; a second data file
would need a generalised endpoint taking a path, not a copy-pasted handler.

The old usernames (`cds`, `cbg`, `palm`, `si`, `scnb`) no longer exist. Devices
with them saved in Safari will fail to authenticate; add aliases pointing at
the same book if that bites.

---

---

## BSHGRP2 — loaded 2026-09-18

351 recipes from 283 spreadsheets: **Mar Vista 133, Sandbar 104, Beach House
114**. Source was a zip of `.xlsx` files arranged `Location / Menu / Sub Menu`.
The converters are not in the repo — they were one-shot scripts — but every
decision they encoded is below, because the same decisions govern any future
load.

### How the shared recipes work

34 spreadsheets sat in a "Beachside 2 Shared Recipes" folder. Each became
**three rows**, one per store, sharing a masterId — because that is what
linking already is here (`Lemon Butter` is five rows under `dp-nb-66-m`). There
is no such thing as a shared book: a login carries exactly one `location` and
filters on it, so a fourth "shared" book would be invisible to every store.

The cost is drift, which is the same tax BSHGRP1 pays. `propagateToLinked()`
shares content fields and deliberately keeps each sibling's own `submenu`, so
cross-listing survives an edit.

### Submenus are per store, on purpose

| Store | Prep submenus |
|---|---|
| Sandbar | Cold Prep, Hot Prep |
| Beach House | Prep, Proteins, Hot Prep |
| Mar Vista | Cold Prep, Hot Prep, Pantry Prep |

Three stores, three vocabularies, kept as the folders had them. BSHGRP1 leaves
`submenu` null on all 550 Dinner Prep recipes; BSHGRP2 does not. `Apps` was
mapped to `Appetizers` because **Mar Vista** uses Appetizers, not because CBG
does.

### Two spreadsheet templates

- **Plate sheet** (231 files) — `Ingredient | Qty | Measure | [Yld %] |
  Instructions`, numbered steps below. Note the `Yld %` column is present on
  some files and absent on others: **read columns from the header row, never by
  position.** Reading by position silently put `100` in the instruction slot on
  four files and threw the real instruction away.
- **Costing sheet** (52 files, all Mar Vista Dinner Prep) — `INGREDIENTS | QTY |
  UOM | COST | EXT COST`, a `Menu Item Name:` header block, uncalculated
  `=IF(...)` formulas that read back as literal text, steps under
  `Prep / Plating Instructions`, and **a 70-row unit-of-measure lookup table
  pasted into every file**. Cut everything from `Menu Category Index` onward or
  each recipe gains 70 fake ingredients. Yield on these is loose text in the
  ingredient column — `yield is 6#`, `7.25 qts yield`, `106 each is yeild` —
  spelled three ways and sometimes with a price attached.

Cost data is dropped. There is no field for it and the figures are dated
7.13.24. If pricing ever matters, those sheets are the only place it exists.

### Read every sheet in a workbook

Three workbooks hold more than one recipe. Reading only the first would have
lost **Bread Pudding** — 16 croissants, 15 eggs, cream, Jim Beam — which exists
nowhere else. `openpyxl`'s `read_only=True` also returns **empty rows** for
these files; use the default mode.

Five sheets in `Prep MV Risotto Base.xlsx` and `Prep MV whiskey bread
pudding .xlsx` were excluded on review: two pair risotto ingredients with
crouton steps and a crouton name (a copied sheet nobody finished), plus a
byte-identical duplicate, a one-ingredient costing fragment, and a plate sheet
the Dinner Menu already covers properly.

### The Instructions column becomes steps

Ingredient-level instructions have no home in the schema, so they were sorted
four ways. Every distinct value was mapped **by hand** — roughly 170 of them
across the four loads — rather than by pattern, so nothing could fall through
unnoticed. The builds asserted zero unmapped.

| Bucket | Becomes | Example |
|---|---|---|
| Action | a step, ahead of the sheet's own | `Seasoned with S/P` → "Season the 4oz. Burger Patty with S/P." |
| Plating | a line under `Expo:` | `garnish on top` → "Micro Cilantro — garnish on top." |
| Cut state | parenthetical on the ingredient | `small diced` → "Red Onion (small diced)" |
| Restatement | dropped | `Kosher Salt \| 1 \| tablespoon \| "1 tablespoon"` |

That last bucket matters: those rows already had a correct qty and unit.
Writing the instruction into qty/unit would have replaced good data with a
duplicate.

**`Expo:` is the only section header in BSHGRP2.** 144 recipes have one. A
`Garnish with X, Y and Z` step that duplicated the Expo block was removed (39)
or folded into it (19). BSHGRP1 keeps its own 316 `Garnish:` headers — its four
affected pasta recipes are linked, so an edit propagates across books, and that
was left alone deliberately.

### Corrections made to the source data

Recorded here because they are not recoverable from the spreadsheets:

- `Mango Salsa` (Beach House) listed Black Pepper as `0.1 teaspoon` in the qty
  column and `1 teaspoon` in the instruction. **1 teaspoon** is correct.
- `Lua Bread 2` / `Lua Bread 4` → **Luau**. The sheets spell it Lua, the
  filenames spell it Luau.
- Store prefixes (`PREP SB`, `MI BH`) stripped from every name — `location`
  already carries the store. Four Sandbar files were prefixed for the *wrong*
  store and were loaded as Sandbar regardless, since that is the folder they
  are in.
- 50 spelling fixes across 14 words. Three are judgement rather than error and
  are easy to reverse if the kitchen spells them its own way: `saute` → `sauté`
  (27), `Bronzino` → `Branzino` (4), `Tator` → `Tater` (1).
- Broken title cells: three sheets have `#VALUE!` where the name should be, one
  says `need picture`, and one says `Master` with the real name (`Sushi Rice`)
  under `Recipe Name:`. The name rule prefers `Recipe Name:`, then a row
  starting `MI`/`PREP`, then the first sane row.

### Known imperfections, left as they are

- **`mango lime butter` exists twice** in Mar Vista, from two files with
  identical contents. One is probably meant to be Mango Lime Base.
- **`Bairdi Crab 1.5LB`** came from a file named `(not current)`. Loaded
  `active: true` on request.
- **27 recipes have no method.** Their sheets number the steps 1 to 12 and
  leave every line blank. Not a parser failure.
- **Calamari's Expo block ends with `Pickled vegetables — garnish.`**, which is
  the umbrella term for two lines above it. The redundancy check matches word
  for word, not concept to concept, so it missed this.

---

## Prep Hub integration — LIVE, all twelve stores

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

`PREP_PATHS` is now exactly the confirmed shapes — the four `index.html` calls
plus the two the yield UI will need. While counting's real route was unknown
the allowlist also carried several guesses at it (`prep-days/{date}/count`,
`/counts`, `/prepped/{id}`); counting turned out to hang off the item, so those
never carried traffic and were removed on 2026-09-17. A test asserts they stay
404. Adding an endpoint means adding the one shape it uses, not a family.

Both the proxy and the site gate authenticate through the same
`authenticatedUser()` helper. The gate used to have its own copy with a bare
`atob()`, which threw on a malformed `Authorization` header instead of
returning 401.

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
`role` field to `USERS_JSON`, sending it instead of the current value, and
hiding those buttons for staff. Deliberately deferred.

The value is not quite hardcoded: the proxy sends `env.PREP_HUB_ROLE ||
"manager"`, so the Worker can be made to claim a different role for *everyone*
without a deploy. That is a blunt instrument — it is per-Worker, not per-login —
and it is not the fix. It is worth knowing the variable exists, because setting
it would change the role on all nine stores at once.

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

182 tests across ten suites, all reading the real `index.html` and `worker.js`
rather than copies. `tests/README.md` lists what each covers and why it exists.
No suite reads anything outside the repo: `prep_proxy` builds its own user
fixture with placeholder passwords, and the live `USERS_JSON` is gitignored.

**Run the tests and push as separate steps.** Chaining them with `&&` let a
failing suite through twice in one session, because the last command in the
chain succeeded.

---

## Architecture as it stands now

### Saving is a merge, not an overwrite

Previously every save sent the **entire recipe array** (1,684 at the time) and overwrote the
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
  against the whole file.

### The recipe schema

Required on every row: `id`, `masterId`, `location`, `name`, `category`,
`ingredients`, `steps`, `images`, `notes`, `yield`, `shelfLife`, `smallware`.
An ingredient is `{name, qty, unit}` plus optional `qty2`/`qty3` — **there is
no note or instruction field**, which is why the source Instructions column had
to be redistributed.

Optional and sparse, absent from most rows: `submenu` (1,582), `active` (456),
`portions` and `portionSize` (249 each), `dualBatch` (106), `yield2` (12).
Anything reading this file must tolerate every one of them being missing.

`portions` and `portionSize` were added 2026-09-18 and render as two separate
pills in Details — **# of Portions** (`36`) and **Portion** (`2 OZ-fl`). Both
are free text, because the sheets write `1`, `12` and `12 each`
interchangeably and a number would lose the unit. They need no special handling
in `shareContentFields`: content fields are whatever is left after `id`,
`masterId`, `location` and the local flags, so they propagate already.
`tests/portions.test.js` covers both, including that a row without them renders
nothing rather than `undefined`.

### Worker (`worker.js`)

**In the repo at the root**, and the tests import it from there. It holds no
secrets, only `env.*` references. Cloudflare is still the thing that actually
runs it, so editing the repo copy changes nothing until it is pasted into the
dashboard and deployed — **they can drift, and only a paste closes the gap.**
Check them against each other before trusting either. Current features:

- `EDIT_PASSWORDS`: a JSON object of label → password. Any one unlocks editing.
  Revoke by deleting the entry. The label goes into the commit message, so
  history now reads `Update recipes.json — 1 edited (Tim)`.
- Merge save with retry (above).
- Reads via the blob API, on **both** save paths.
- **Two guards against a save that destroys the file.** Neither can be tested
  against production without sending the input that does the damage, so they
  are covered by tests only:
  - Refuses to write an empty recipe list. This used to live inside the merge
    branch, which meant the legacy whole-array path skipped it — `isFull` is
    only an `Array.isArray` check, so `recipes: []` passed validation and wrote
    an empty file over every recipe in the repo. Fixed 2026-09-17.
  - Refuses a **legacy** save that would leave less than half the file, with a
    409 telling the person to hard-refresh. Same accident short of zero: a tab
    that loaded 2,000 recipes and saves back 40. Exactly half still passes. Merge saves
    are exempt, because there every removal arrives as an explicit id with its
    base, so a large shrink is something a person asked for.

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

## Bugs worth not repeating

Accumulated across sessions. Items 16–20 are from the BSHGRP2 load.

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
13. **A guard that only ran on one of two paths.** The empty-recipe-list check
    sat inside `if (isMerge)`, so the legacy whole-array save walked straight
    past it. When a safety check lives inside a branch, ask what the other
    branch does.
14. **Tests that pass because they never ran.** Three suites imported
    `./worker.js` and had been crashing on module resolution since `worker.js`
    moved to the repo root. `run-all.mjs` prints CRASHED and exits non-zero,
    but a crash reads like noise next to nine lines of pass counts. Check the
    total, not the last line.
15. **A test that depended on a file full of live passwords.** `prep_proxy`
    read `users_full.min.json` from the working directory, so it only ran on
    one machine and the repo was one `git add .` from publishing every store
    login. Tests get fixtures; there is now a `.gitignore` as a second line.
16. **A filter that widens instead of replacing.** `init()` put a store's own
    book into `activeLocs`; `applyFiltersFromUrl()` added a second from the
    URL, and `getFiltered()` reads the set as "show any of these" while
    skipping the group check for restricted logins. Two books in a set meant
    both were shown. The write side never emitted `loc=` for those logins, so
    the read side looked safe — **check the reader, not the writer.**
17. **Reading a spreadsheet by column position.** Some sheets carry an extra
    `Yld %` column. A positional parser put `100` in the instruction slot on
    four files and threw the real instruction away, silently. **Read the header
    row.**
18. **`openpyxl`'s `read_only=True` returned empty rows** for every file in
    this set, so a structural survey reported "no header" across the board.
    A fast path that lies is worse than a slow one.
19. **Reading only the first sheet of a workbook.** Three files held more than
    one recipe; one held the only copy of Bread Pudding. This went unnoticed
    through three loads before Mar Vista made it obvious.
20. **Restarting id numbering at 1.** `dm-sb-1` collided with 33 rows the
    shared load had already written. Derive the next id from the live file,
    never from the batch.
21. **Running a text transform in the wrong order.** Fixing the typo `mirco` →
    `micro` *after* comparing garnish text against the Expo block meant the
    line did not match and survived as a duplicate. Normalise first, then
    compare.

---

## Active constraints

- Never link recipes across locations unless content is genuinely identical.
- `active: false` to hide a recipe; never delete when that would do.
- BSHGRP / BSHGRP2 are fully independent — no cross-group browsing, filtering
  or master-linking, even on a `masterId` collision.
- Deep-clone anything that creates a new recipe object from an existing one.
  Shallow copies caused a bidirectional-editing bug once already.
- Diff-check before starting and immediately before pushing, every time. Two
  people (Tim and Kory/bodzak) edit concurrently.
- **Preview before writing, always.** Every load in this project surfaced
  something in review that no amount of staring at the parser would have:
  corrupted sheets, a tenfold quantity error, a recipe that existed only on a
  second worksheet. The previews are the reason those were caught.
- **Derive ids from the live file, never from the batch.**
- When mismatches are found in linked groups, flag for human review rather than
  auto-merging or auto-unlinking.

---

## Open tasks

### Prep Hub follow-ups

1. **Yield tests are not built.** The endpoint is allowlisted and the body
   shape is known — UI work only.
2. **Roles** — see the gap above.
3. **~40 unlinked prep items** need a human decision.

### Blocked on you / the SOP

4. **Char Grill Method for sirloin burgers.** SOP §8 says *"(Steps to be
   added.)"*. Four recipes waiting: `Sirloin Burger (All Stores)` (CBG + NB,
   linked), `Palm (Sirloin) Burger`, `Backyard Burger`.
5. **Scallops — 7 recipes, no SOP section.** They sear on *both* flat sides,
   which none of the existing rules cover. Currently untouched by design.
6. **Do smash burgers finish with lemon butter?** §7 doesn't say; the universal
   rule says always. `Smash Burgers` (CBG) currently has none.
7. **Five kid burgers** deliberately skipped — currently two lines each
   ("Place the burger on the grill. Turn over halfway"). Decide whether they
   should get the full technique.

### Security / hygiene

8. **Rotate the GitHub PAT.** Outstanding across several sessions now, and
   exposed in more transcripts each time it is pasted. A fine-grained token
   scoped to this one repo with Contents: read and write is all any session
   needs — not a classic `repo`-scoped one.
9. **Rotate all twelve store logins and the admin password.** Pasted into
   transcripts on 2026-09-17 and again on 2026-09-18, and exported to a
   spreadsheet. Every store shares one password, so one leak is twelve stores.
   Worth giving each site its own while changing them anyway — and note that
   every iPad has the old one saved in Safari, so someone has to go round.
10. **Re-add the Cloudflare config as encrypted Secrets.** Still plain Variables.
    See the top of this document.
11. **`drm-nb-45` was hard-deleted** rather than set `active: false`, against
    convention. Recoverable from git history if unintended.

Done since the last handoff: `worker.js` and the test suite are committed, the
suite runs from a clean checkout, the site gate and the proxy share one auth
path, `PREP_PATHS` carries only real routes, and both save guards are in place.

### BSHGRP2 follow-ups

12. **Build `prep-links.json` entries for BSHGRP2.** The three codes are
    settled and in `PREP_STORE_CODES` as of 2026-09-18, so the proxy works —
    but ingredient-to-prep-recipe links are per store and BSHGRP2 has none yet.
    Do this after Jon's prep items exist for the three sites.
13. **Decide whether `mango lime butter` (×2, Mar Vista) should be one recipe**,
    with one renamed to Mango Lime Base.
14. **27 BSHGRP2 recipes have no method.** Someone who cooks them has to write
    it; there is nothing in the source to recover.
15. **Drop `Pickled vegetables — garnish.`** from Mar Vista Calamari's Expo
    block if you agree it duplicates the two lines above it.
16. **BSHGRP1's four pasta recipes** still have a `Garnish with garlic bread`
    step alongside an Expo block. Left alone because they are linked; decide
    whether the BSHGRP2 treatment should apply there too.

### Data quality

17. **46 linked groups are internally divergent** (out of 358). The old
    `Beachside_Linked_Recipe_Mismatches.xlsx` is stale — regenerate before
    acting. Every fish group opened this session turned out divergent, and the
    fix was the same shape each time: normalise wording, standardise headers,
    pick one Expo line. Worth one systematic sweep rather than discovering them
    group by group. `Grouper Sandwich` (4 stores) and `Grouper Dinner` are done.
18. **"Wrong protein" scan.** `Bairdi (3/4#) & Shrimp` referenced ribs
    throughout because it was copied from a ribs plate. Scan for recipes
    mentioning a protein absent from their ingredients.
19. **`Lightly season chicken with steak seasoning`** — one recipe. Deliberate
    or copy-paste?
20. **`Honey Fig Salmon`** lists `Old bay` in ingredients but its step now says
    requested seasoning.
21. **Clear filters doesn't reset the address bar** — if someone clicks the
    Link button then clears filters, a pin at that moment captures stale
    filters.
22. **`loc=` gap for single-store logins.** In `applyFiltersFromUrl()`, a
    store login opening `?loc=Mar Vista` would see it, crossing the
    BSHGRP/BSHGRP2 boundary. The Link button sidesteps this by never emitting
    `loc=` for those logins, but the reader is still permissive. Three-line fix.

### Older threads, untouched all session

23. **Drink batch-size project**: Palm ✅, North Beach ✅. CBG, CDS, Salty's
    Island still not sent. Also unresolved: the Miami Vice rum-brand mismatch
    ("Planteray Dark Rum" saved vs "Cruzan 137 Rum" in the newer doc).
24. **Brussels Sprouts overlap at Salty's Island** — `Brussels Sprouts
    (Appetizer)` vs `Brussels Sprout Side`. Never got a yes/no.
25. **Spanish translation — paused.** Bilingual-in-place schema (`name_es`,
    `steps_es[]`, per-ingredient `name_es`) so `masterId` propagation keeps
    working; language toggle in the UI; batches by location + category; a
    fluent speaker spot-checks before it goes on the line. **Still unanswered:
    which Spanish variant** (neutral/Latin American, Mexican, Caribbean).
26. **Periodic duplicate/mislabel scan** — group by location+category+submenu+
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
three stores, and grouping keeps linked siblings together. For a bulk import,
batch by store and do the simplest store first: Sandbar before Mar Vista meant
the costing-sheet parser was the only new problem when it finally arrived.

**Say what you changed and why, in the commit.** These messages are the only
record of the judgement calls once the chat is gone — which sheet was excluded,
which quantity was corrected, which spelling was a decision rather than a fix.
