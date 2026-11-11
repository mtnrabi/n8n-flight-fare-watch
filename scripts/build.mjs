// Builds the two importable workflow files in workflows/ from one definition.
// Run: node scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsCode = readFileSync(join(root, 'src/pick-cheapest.js'), 'utf8');

const settings = {
  id: 'b1a7c0de-0000-4000-8000-000000000002', name: 'Watch settings', type: 'n8n-nodes-base.set', typeVersion: 3.4,
  position: [220, 300],
  parameters: {
    assignments: { assignments: [
      { id: 'a1', name: 'from', value: 'JFK', type: 'string' },
      { id: 'a2', name: 'to', value: 'LIS', type: 'string' },
      // rolling dates: 45 days from today, 7 nights. Replace with fixed dates like 2027-02-01 if you prefer.
      { id: 'a3', name: 'departure_date', value: "={{ $now.plus({ days: 45 }).toFormat('yyyy-MM-dd') }}", type: 'string' },
      { id: 'a4', name: 'return_date', value: "={{ $now.plus({ days: 52 }).toFormat('yyyy-MM-dd') }}", type: 'string' },
      { id: 'a5', name: 'target_price', value: 600, type: 'number' },
      { id: 'a6', name: 'currency', value: 'usd', type: 'string' },
      { id: 'a7', name: 'always_send', value: false, type: 'boolean' },
      { id: 'a8', name: 'email_to', value: 'you@example.com', type: 'string' },
    ] },
    options: {},
  },
};

const trigger = {
  id: 'b1a7c0de-0000-4000-8000-000000000001', name: 'Every morning', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
  position: [0, 300], parameters: { rule: { interval: [{ field: 'days', triggerAtHour: 8 }] } },
};

const flightPowersNode = {
  id: 'b1a7c0de-0000-4000-8000-000000000003', name: 'Search round trip', type: 'n8n-nodes-flightpowers.flightPowers', typeVersion: 1,
  position: [440, 300],
  parameters: {
    resource: 'flight', operation: 'searchRoundTrip',
    from_airport: '={{ $json.from }}', to_airport: '={{ $json.to }}',
    departure_date: '={{ $json.departure_date }}', return_date: '={{ $json.return_date }}',
    options: { currency: '={{ $json.currency }}', limit: 10, sort_type: 'Price' },
  },
  credentials: { flightPowersApi: { id: '', name: 'FlightPowers account' } },
};

const httpNode = {
  id: 'b1a7c0de-0000-4000-8000-000000000003', name: 'Search round trip', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  position: [440, 300],
  parameters: {
    method: 'POST',
    url: 'https://google-flights-live-api.p.rapidapi.com/api/google_flights/roundtrip/v1',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'x-rapidapi-host', value: 'google-flights-live-api.p.rapidapi.com' }] },
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ from_airport: $json.from, to_airport: $json.to, departure_date: $json.departure_date, return_date: $json.return_date, currency: $json.currency, limit: 10, sort_type: 'Price', _fp_source: 'gh-example', _fp_tool: 'n8n-flight-fare-watch' }) }}",
    options: { timeout: 90000 },
  },
  credentials: { httpHeaderAuth: { id: '', name: 'RapidAPI key (x-rapidapi-key)' } },
};

const code = {
  id: 'b1a7c0de-0000-4000-8000-000000000004', name: 'Cheapest fare, alert?', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [660, 300], parameters: { jsCode },
};

const email = {
  id: 'b1a7c0de-0000-4000-8000-000000000005', name: 'Email me', type: 'n8n-nodes-base.emailSend', typeVersion: 2.1,
  position: [880, 220],
  parameters: {
    fromEmail: 'fare-watch@example.com', toEmail: "={{ $('Watch settings').first().json.email_to }}",
    subject: '={{ $json.subject }}', emailFormat: 'text', text: '={{ $json.text }}', options: {},
  },
  credentials: { smtp: { id: '', name: 'SMTP account' } },
};

const slack = {
  id: 'b1a7c0de-0000-4000-8000-000000000006', name: 'Slack (incoming webhook)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  position: [880, 400], disabled: true,
  parameters: {
    method: 'POST', url: 'https://hooks.slack.com/services/REPLACE/WITH/YOURS',
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ text: $json.text }) }}', options: {},
  },
};

function workflow(name, search) {
  const nodes = [trigger, settings, search, code, email, slack];
  return {
    name,
    nodes,
    connections: {
      'Every morning': { main: [[{ node: 'Watch settings', type: 'main', index: 0 }]] },
      'Watch settings': { main: [[{ node: 'Search round trip', type: 'main', index: 0 }]] },
      'Search round trip': { main: [[{ node: 'Cheapest fare, alert?', type: 'main', index: 0 }]] },
      'Cheapest fare, alert?': { main: [[
        { node: 'Email me', type: 'main', index: 0 },
        { node: 'Slack (incoming webhook)', type: 'main', index: 0 },
      ]] },
    },
    settings: { executionOrder: 'v1' },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    tags: [],
  };
}

const out = [
  ['workflows/fare-watch-flightpowers-node.json', workflow('Daily fare watch (FlightPowers node)', flightPowersNode)],
  ['workflows/fare-watch-http-request.json', workflow('Daily fare watch (HTTP Request)', httpNode)],
];
for (const [file, wf] of out) writeFileSync(join(root, file), JSON.stringify(wf, null, 2) + '\n');
console.log(out.map(([f]) => f).join('\n'));
