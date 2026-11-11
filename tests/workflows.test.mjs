import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const WORKFLOWS = ['workflows/fare-watch-flightpowers-node.json', 'workflows/fare-watch-http-request.json'];
const rows = read('recorded/JFK-LIS_2027-02-01_2027-02-08.json'); // real response, fetched 2026-11-11 21:55 UTC

// Run the Code node exactly as written in the workflow, with n8n's $ and $input stand-ins.
async function runCode(jsCode, items, settings) {
  const $ = (name) => {
    assert.equal(name, 'Watch settings');
    return { first: () => ({ json: settings }) };
  };
  const $input = { all: () => items };
  const fn = new Function('$', '$input', `return (async () => { ${jsCode} })();`);
  return fn($, $input);
}

const base = { from: 'JFK', to: 'LIS', currency: 'usd', always_send: false };

for (const file of WORKFLOWS) {
  test(`${file}: every connection points at a real node`, () => {
    const wf = read(file);
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.equal(names.size, wf.nodes.length, 'node names are unique');
    for (const [from, c] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), from);
      for (const out of c.main) for (const t of out) assert.ok(names.has(t.node), t.node);
    }
    assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'));
  });

  test(`${file}: Code node alerts under target on a real response`, async () => {
    const code = read(file).nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
    const out = await runCode(code, rows.map((r) => ({ json: r })), { ...base, target_price: 650 });
    assert.equal(out.length, 1);
    assert.equal(out[0].json.price, 628);
    assert.match(out[0].json.text, /628 USD round trip/);
    assert.match(out[0].json.text, /Book: https:\/\/www\.google\.com\/travel\/flights/);
    assert.deepEqual(out[0].json.reasons, ['at or under your target of 650']);
  });

  test(`${file}: Code node stays quiet when the fare is not a deal`, async () => {
    const code = read(file).nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
    const out = await runCode(code, rows.map((r) => ({ json: r })), { ...base, target_price: 600 });
    assert.deepEqual(out, []);
  });
}

test('Code node also accepts the whole array in one item (HTTP Request without splitting)', async () => {
  const code = read(WORKFLOWS[1]).nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
  const out = await runCode(code, [{ json: { data: rows } }], { ...base, target_price: 650 });
  assert.equal(out[0].json.price, 628);
});

test('always_send sends a daily summary even without a deal', async () => {
  const code = read(WORKFLOWS[0]).nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
  const out = await runCode(code, rows.map((r) => ({ json: r })), { ...base, target_price: 100, always_send: true });
  assert.match(out[0].json.text, /Daily summary/);
});

test('the FlightPowers node uses the node package parameter names', () => {
  const n = read(WORKFLOWS[0]).nodes.find((x) => x.type === 'n8n-nodes-flightpowers.flightPowers');
  assert.equal(n.parameters.resource, 'flight');
  assert.equal(n.parameters.operation, 'searchRoundTrip');
  for (const k of ['from_airport', 'to_airport', 'departure_date', 'return_date']) assert.ok(n.parameters[k], k);
  assert.ok(n.credentials.flightPowersApi);
});
