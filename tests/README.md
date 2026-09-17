# Tests

173 tests across ten suites. They have caught real bugs repeatedly — read
"What these exist for" below before deciding any of them is noise.

## Running them

From the repo root:

```
npm install jsdom          # the only dependency
node tests/run-all.mjs     # everything
node tests/counting.test.js   # or one suite
```

Requires Node 18+. The suites read `index.html` and `worker.js` from the repo
root and pull the real functions out of them, so they test the shipped code
rather than a copy that can drift.

## The suites

| File | Covers |
|---|---|
| `worker.test.mjs` | `EDIT_PASSWORDS` multi-password auth, revocation, malformed config |
| `worker_merge.test.mjs` | The merge save: per-recipe apply, deletions, write races, the >1MB blob read |
| `prep_proxy.test.mjs` | The `/prep/*` proxy: store scoping, service key, path allowlist, 409 passthrough |
| `store_split.test.mjs` | Nine stores mapping onto five recipe books, header badge, apostrophe escaping |
| `propagation.test.js` | Linked-recipe propagation, cross-listed submenus, array-sharing |
| `deeplink.test.js` | `?recipe=` and `?master=` links and their book scoping |
| `prep_links.test.js` | Ingredient → prep recipe links and the second-layer modal |
| `prepsheet_live.test.js` | The Prep Sheet reading live from the Prep Hub |
| `prepday.test.js` | Day phase model, start/finish/reopen, actor names |
| `counting.test.js` | On-hand counts, prepped amounts, par basis, error handling |

## What these exist for

Every one of these was written after a real bug. A sample:

- **Chicken nearly got the steak procedure.** "Rotate 45 degrees" and "diamond
  marks" are not steak-specific, and ten chicken recipes matched a steak sweep.
  Seasoning chicken on both sides instead of skin-side-only would have gone
  live.
- **A shared `masterId` can hold two rows in the same book.** SI's Grouper is
  cross-listed under three submenus. Propagating `submenu` collapsed them onto
  one and the recipe vanished from two menus.
- **`phase` was read before it was declared**, so the whole Prep Sheet render
  threw and showed a permanent "Loading…".
- **`esc()` throws on a number.** The Prep Hub returns real numbers; the old
  snapshot returned strings.
- **Store scoping must be structural.** A store login cannot be allowed to
  reach another store's prep data by any route — query param, ingredient name
  or URL. Several tests exist only to prove that.

## The lesson worth keeping

**Test fakes keep being more forgiving than reality, and that is exactly where
the bugs live.**

The merge save shipped broken because the fake GitHub in `worker_merge.test.mjs`
returned a populated `content` field at every file size. The real Contents API
withholds it above ~1 MB, and `recipes.json` is 2 MB. Tests passed, production
returned a 500.

When writing a fake, mirror the real service's *limits and failure modes*, not
its happy path.
