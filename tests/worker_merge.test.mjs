// Tests for the merge-save Worker.
//
// Two layers:
//   1. mergeRecipes() as a pure function — the core correctness argument.
//   2. The whole /save endpoint against a fake in-memory GitHub, including
//      a mid-save race that forces the 409 retry path.
//
// Functions are pulled out of the real worker.js so the test can't drift.

import fs from 'fs';
import assert from 'assert';

const src = fs.readFileSync('worker.js', 'utf8');
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `could not find ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const stable = eval('(' + extract('stable') + ')');
const mergeRecipes = eval('(' + extract('mergeRecipes') + ')');

let pass = 0;
const t = async (desc, fn) => {
  try { await fn(); console.log('  ok  ' + desc); pass++; }
  catch (e) { console.log('  FAIL ' + desc + '\n       ' + e.message); process.exitCode = 1; }
};

const R = (id, name, extra = {}) => ({ id, name, steps: ['a'], ...extra });
const base = (r) => stable(r);

(async () => {

console.log('\nstable() ignores key order, not content');
await t('same data, different key order, same string', () => {
  assert.strictEqual(stable({ a: 1, b: 2 }), stable({ b: 2, a: 1 }));
});
await t('nested objects and arrays are normalised too', () => {
  assert.strictEqual(
    stable({ x: [{ p: 1, q: 2 }] }),
    stable({ x: [{ q: 2, p: 1 }] }));
});
await t('array ORDER still matters (steps must not be reordered silently)', () => {
  assert.notStrictEqual(stable({ s: ['a', 'b'] }), stable({ s: ['b', 'a'] }));
});
await t('a real content change shows up', () => {
  assert.notStrictEqual(stable(R('1', 'Mahi')), stable(R('1', 'Mahi 6oz')));
});

console.log('\nthe whole point: two people editing different recipes');
await t("my edit lands and does not touch Kory's recipe", () => {
  const disk = [R('1', 'Mahi'), R('2', 'Grouper'), R('3', 'Snapper')];
  const loaded = R('1', 'Mahi');
  // Kory already saved a change to #2 — it is on disk, I never saw it.
  disk[1] = R('2', 'Grouper Blackened');
  const { merged, report } = mergeRecipes(disk, [{ id: '1', base: base(loaded), recipe: R('1', 'Mahi 10oz') }], []);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0].name, 'Mahi 10oz', 'my edit should land');
  assert.strictEqual(merged[1].name, 'Grouper Blackened', "Kory's edit must survive");
  assert.deepStrictEqual(report.overwrote, [], 'no overwrite — different recipes');
});
await t('a full-array save would have destroyed it (documents the old bug)', () => {
  const disk = [R('1', 'Mahi'), R('2', 'Grouper Blackened')];
  const myStaleWholeArray = [R('1', 'Mahi 10oz'), R('2', 'Grouper')];
  // This is what the old endpoint wrote verbatim:
  assert.strictEqual(myStaleWholeArray[1].name, 'Grouper', "Kory's change is gone — the thing we are fixing");
  assert.strictEqual(disk[1].name, 'Grouper Blackened');
});
await t('edits to many different recipes all apply at once', () => {
  const disk = [R('1', 'a'), R('2', 'b'), R('3', 'c'), R('4', 'd')];
  const changed = ['1', '2', '3'].map(id => ({
    id, base: base(disk.find(r => r.id === id)), recipe: R(id, 'new' + id),
  }));
  const { merged, report } = mergeRecipes(disk, changed, []);
  assert.deepStrictEqual(merged.map(r => r.name), ['new1', 'new2', 'new3', 'd']);
  assert.strictEqual(report.updated.length, 3);
});
await t('order and position of untouched recipes is preserved', () => {
  const disk = [R('1', 'a'), R('2', 'b'), R('3', 'c')];
  const { merged } = mergeRecipes(disk, [{ id: '2', base: base(disk[1]), recipe: R('2', 'B!') }], []);
  assert.deepStrictEqual(merged.map(r => r.id), ['1', '2', '3']);
});

console.log('\nsame-recipe collision: last writer wins, but it is reported');
await t('my edit overwrites theirs', () => {
  const loaded = R('1', 'Mahi');
  const disk = [{ ...R('1', 'Mahi Kory Version') }];
  const { merged, report } = mergeRecipes(disk, [{ id: '1', base: base(loaded), recipe: R('1', 'Mahi My Version') }], []);
  assert.strictEqual(merged[0].name, 'Mahi My Version');
  assert.deepStrictEqual(report.overwrote, ['1'], 'must be reported, not silent');
});
await t('no overwrite reported when nobody else touched it', () => {
  const disk = [R('1', 'Mahi')];
  const { report } = mergeRecipes(disk, [{ id: '1', base: base(disk[0]), recipe: R('1', 'Mahi 10oz') }], []);
  assert.deepStrictEqual(report.overwrote, []);
});
await t('a key-order-only difference is NOT reported as an overwrite', () => {
  const disk = [{ name: 'Mahi', id: '1', steps: ['a'] }];
  const loaded = { id: '1', name: 'Mahi', steps: ['a'] };
  const { report } = mergeRecipes(disk, [{ id: '1', base: base(loaded), recipe: R('1', 'Mahi 10oz') }], []);
  assert.deepStrictEqual(report.overwrote, [], 'key order must not look like a conflict');
});

console.log('\nnew recipes');
await t('a new recipe is appended', () => {
  const disk = [R('1', 'a')];
  const { merged, report } = mergeRecipes(disk, [{ id: '9', base: null, recipe: R('9', 'New') }], []);
  assert.strictEqual(merged.length, 2);
  assert.deepStrictEqual(report.inserted, ['9']);
});
await t('editing a recipe someone else deleted brings it back, and says so', () => {
  const disk = [R('1', 'a')];
  const { merged, report } = mergeRecipes(disk, [{ id: '2', base: base(R('2', 'b')), recipe: R('2', 'b edited') }], []);
  assert.strictEqual(merged.length, 2);
  assert.deepStrictEqual(report.resurrected, ['2']);
  assert.deepStrictEqual(report.inserted, [], 'not a fresh insert — it existed when I loaded');
});

console.log('\ndeletions');
await t('a clean delete removes exactly one recipe', () => {
  const disk = [R('1', 'a'), R('2', 'b'), R('3', 'c')];
  const { merged, report } = mergeRecipes(disk, [], [{ id: '2', base: base(disk[1]) }]);
  assert.deepStrictEqual(merged.map(r => r.id), ['1', '3']);
  assert.deepStrictEqual(report.removed, ['2']);
});
await t('deleting something already gone is not an error', () => {
  const disk = [R('1', 'a')];
  const { merged, report } = mergeRecipes(disk, [], [{ id: '7', base: base(R('7', 'x')) }]);
  assert.strictEqual(merged.length, 1);
  assert.deepStrictEqual(report.alreadyGone, ['7']);
});
await t('deleting a recipe someone else just edited is reported', () => {
  const disk = [R('1', 'a'), R('2', 'b edited by Kory')];
  const { merged, report } = mergeRecipes(disk, [], [{ id: '2', base: base(R('2', 'b')) }]);
  assert.deepStrictEqual(merged.map(r => r.id), ['1']);
  assert.deepStrictEqual(report.overwrote, ['2']);
});
await t('several deletions at once remove the right ones', () => {
  const disk = [R('1', 'a'), R('2', 'b'), R('3', 'c'), R('4', 'd')];
  const { merged } = mergeRecipes(disk, [],
    [{ id: '1', base: base(disk[0]) }, { id: '3', base: base(disk[2]) }]);
  assert.deepStrictEqual(merged.map(r => r.id), ['2', '4']);
});
await t('an edit and a delete in the same save both apply', () => {
  const disk = [R('1', 'a'), R('2', 'b')];
  const { merged } = mergeRecipes(disk,
    [{ id: '1', base: base(disk[0]), recipe: R('1', 'A!') }],
    [{ id: '2', base: base(disk[1]) }]);
  assert.deepStrictEqual(merged.map(r => r.name), ['A!']);
});

console.log('\nmerging never loses or duplicates recipes');
await t('1,000 untouched recipes survive a one-recipe edit', () => {
  const disk = Array.from({ length: 1000 }, (_, i) => R(String(i), 'r' + i));
  const { merged } = mergeRecipes(disk, [{ id: '500', base: base(disk[500]), recipe: R('500', 'changed') }], []);
  assert.strictEqual(merged.length, 1000);
  assert.strictEqual(new Set(merged.map(r => r.id)).size, 1000);
  assert.strictEqual(merged[500].name, 'changed');
});
await t('the input array is not mutated', () => {
  const disk = [R('1', 'a'), R('2', 'b')];
  const snapshot = JSON.stringify(disk);
  mergeRecipes(disk, [{ id: '1', base: base(disk[0]), recipe: R('1', 'zzz') }], [{ id: '2', base: base(disk[1]) }]);
  assert.strictEqual(JSON.stringify(disk), snapshot, 'merge must be pure');
});
await t('empty change set leaves the data identical', () => {
  const disk = [R('1', 'a'), R('2', 'b')];
  const { merged } = mergeRecipes(disk, [], []);
  assert.deepStrictEqual(merged, disk);
});

// ── endpoint-level tests against a fake GitHub ────────────────────────────
console.log('\nthe /save endpoint end to end');

const workerMod = await import('../worker.js');
const worker = workerMod.default;

function fakeGitHub(initial, opts = {}) {
  const state = { arr: initial.slice(), sha: 'sha0', puts: 0, n: 0, blobs: {} };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (method === 'GET') {
      // Blob read: the Worker fetches content by sha, because the real Contents
      // API withholds it for files over ~1MB.
      const blob = String(url).match(/\/git\/blobs\/(.+)$/);
      if (blob) {
        const body = state.blobs[blob[1]];
        if (body === undefined) return { ok: false, status: 404, text: async () => 'no such blob' };
        return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
      }
      state.n++;
      const text = JSON.stringify(state.arr, null, 2);
      state.blobs[state.sha] = text;
      // Mirror the real API: large files come back with encoding "none" and an
      // EMPTY content field. Faking a populated one is what let a 500 through.
      const payload = { sha: state.sha, size: text.length, encoding: 'none', content: '' };
      if (opts.raceOnRead === state.n) opts.race(state);
      return { ok: true, status: 200, json: async () => payload, text: async () => '' };
    }
    const body = JSON.parse(init.body);
    state.puts++;
    if (body.sha !== state.sha) {
      return { ok: false, status: 409, text: async () => 'sha mismatch', json: async () => ({}) };
    }
    state.arr = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    state.sha = 'sha' + state.puts;
    state.msg = body.message;
    return { ok: true, status: 200, json: async () => ({ commit: { sha: 'commit' + state.puts } }), text: async () => '' };
  };
  return state;
}

const ENV = { EDIT_PASSWORDS: '{"admin":"pw"}', GITHUB_TOKEN: 'x', GH_REPO_OWNER: 'o', GH_REPO_NAME: 'n' };
const post = (body) => worker.fetch(
  new Request('https://w.dev/save', { method: 'POST', body: JSON.stringify(body) }), ENV);

await t('a merge save writes only the changed recipe', async () => {
  const gh = fakeGitHub([R('1', 'a'), R('2', 'b')]);
  const res = await post({ password: 'pw', changed: [{ id: '2', base: base(R('2', 'b')), recipe: R('2', 'B!') }] });
  const j = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(j.ok, true);
  assert.deepStrictEqual(gh.arr.map(r => r.name), ['a', 'B!']);
  assert.deepStrictEqual(j.updated, ['2']);
});
await t('the legacy whole-array format still works', async () => {
  const gh = fakeGitHub([R('1', 'a')]);
  const res = await post({ password: 'pw', recipes: [R('1', 'a'), R('2', 'b')] });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(gh.arr.length, 2);
});
await t('a wrong password is rejected before anything is read', async () => {
  const gh = fakeGitHub([R('1', 'a')]);
  const res = await post({ password: 'nope', changed: [{ id: '1', base: base(R('1', 'a')), recipe: R('1', 'x') }] });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(gh.puts, 0);
});
await t('a save with nothing in it is refused', async () => {
  const res = await post({ password: 'pw', changed: [], deleted: [] });
  assert.strictEqual(res.status, 400);
});
await t('an id that disagrees with its recipe body is refused', async () => {
  const gh = fakeGitHub([R('1', 'a')]);
  const res = await post({ password: 'pw', changed: [{ id: '1', base: null, recipe: R('2', 'a') }] });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(gh.puts, 0);
});
await t('a write race is retried and still lands correctly', async () => {
  const gh = fakeGitHub([R('1', 'a'), R('2', 'b')], {
    raceOnRead: 1,
    race: (s) => {   // Kory saves #1 after we read, before we write
      s.arr = [R('1', 'a KORY'), R('2', 'b')];
      s.sha = 'shaKORY';
      s.blobs['shaKORY'] = JSON.stringify(s.arr, null, 2);
    },
  });
  const res = await post({ password: 'pw', changed: [{ id: '2', base: base(R('2', 'b')), recipe: R('2', 'B!') }] });
  const j = await res.json();
  assert.strictEqual(j.ok, true);
  assert.ok(j.attempts >= 2, 'should have retried');
  assert.deepStrictEqual(gh.arr.map(r => r.name), ['a KORY', 'B!'],
    "the retry must rebuild on Kory's version, not clobber it");
});
await t('the commit message says what changed and who saved', async () => {
  const gh = fakeGitHub([R('1', 'a')]);
  await post({ password: 'pw', changed: [{ id: '1', base: base(R('1', 'a')), recipe: R('1', 'A') }] });
  assert.ok(gh.msg.includes('1 edited'), gh.msg);
  assert.ok(gh.msg.includes('(admin)'), gh.msg);
});
await t('a merge that would empty the file is refused', async () => {
  const gh = fakeGitHub([R('1', 'a')]);
  const res = await post({ password: 'pw', deleted: [{ id: '1', base: base(R('1', 'a')) }] });
  assert.strictEqual(res.status, 500);
  assert.strictEqual(gh.arr.length, 1, 'nothing should have been written');
});
// The legacy path used to skip this guard entirely: isFull is only an
// Array.isArray check, so `recipes: []` passed validation, went straight to
// `out = body.recipes`, and wrote an empty file over every recipe in the repo.
// A stale tab is all it would have taken.
await t('a LEGACY whole-array save of [] is refused too', async () => {
  const gh = fakeGitHub([R('1', 'a'), R('2', 'b')]);
  const res = await post({ password: 'pw', recipes: [] });
  assert.strictEqual(res.status, 500);
  assert.strictEqual(gh.puts, 0, 'nothing should have been written');
  assert.deepStrictEqual(gh.arr.map(r => r.name), ['a', 'b'], 'the data must survive');
});
await t('a legacy save that keeps at least one recipe still lands', async () => {
  const gh = fakeGitHub([R('1', 'a'), R('2', 'b')]);
  const res = await post({ password: 'pw', recipes: [R('1', 'a')] });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(gh.arr.map(r => r.name), ['a']);
});
// Short of zero, the same accident: a tab that loaded 1,688 recipes and saves
// back 40 destroys everything added since. Refuse when less than half survives.
const many = (n, tag = 'r') => Array.from({ length: n }, (_, i) => R(String(i + 1), tag + i));
await t('a legacy save that drops most of the file is refused', async () => {
  const gh = fakeGitHub(many(100));
  const res = await post({ password: 'pw', recipes: many(40) });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(gh.puts, 0, 'nothing should have been written');
  assert.strictEqual(gh.arr.length, 100, 'the data must survive');
  assert.ok((await res.json()).error.includes('100 to 40'));
});
await t('exactly half is still allowed — the guard is "more than half"', async () => {
  const gh = fakeGitHub(many(100));
  const res = await post({ password: 'pw', recipes: many(50) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(gh.arr.length, 50);
});
await t('a MERGE save may delete freely — the ids are explicit', async () => {
  const disk = many(10);
  const gh = fakeGitHub(disk);
  const res = await post({
    password: 'pw',
    deleted: disk.slice(0, 9).map(r => ({ id: r.id, base: base(r) })),
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(gh.arr.length, 1, 'an explicit bulk delete is not a stale copy');
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
})();
