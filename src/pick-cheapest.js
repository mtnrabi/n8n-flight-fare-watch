// Code node body ("Run Once for All Items") shared by both workflows.
// Input: one item per itinerary from the flight search. Output: ONE item with the alert, or none.
// Edit the rules here, then run `node scripts/build.mjs` to copy this code into the workflow files.
const s = $('Watch settings').first().json;
const rows = $input.all()
  .flatMap((i) => (Array.isArray(i.json) ? i.json : Array.isArray(i.json.data) ? i.json.data : [i.json]))
  .filter((r) => typeof (r.total_price_as_number ?? r.price_as_number) === 'number');
if (rows.length === 0) return [];

const price = (r) => r.total_price_as_number ?? r.price_as_number;
const best = rows.reduce((a, b) => (price(b) < price(a) ? b : a));
const p = price(best);
const cur = String(s.currency || 'usd').toUpperCase();

const why = [];
if (s.target_price != null && s.target_price !== '' && p <= Number(s.target_price)) why.push(`at or under your target of ${s.target_price}`);
if (typeof best.price_insights_low === 'number' && p < best.price_insights_low) why.push(`under Google's usual range (${best.price_insights_low}-${best.price_insights_high})`);
if (best.price_range_in_relation_to_other_periods === 'low') why.push('Google rates it LOW for these dates');
if (why.length === 0 && !s.always_send) return [];

const fetchedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const text = [
  `${s.from} -> ${s.to}, ${best.departure_date} to ${best.return_date}: ${p} ${cur} round trip`,
  `Outbound: ${best.departure_flight_airline}, ${best.departure_flight_stops} stop(s), ${best.departure_flight_departure_description}`,
  `Return: ${best.return_flight_airline}, ${best.return_flight_stops} stop(s), ${best.return_flight_departure_description}`,
  `Google: ${best.price_range_in_relation_to_other_periods} (usual ${best.price_insights_low}-${best.price_insights_high} ${cur})`,
  why.length ? `Why: ${why.join('; ')}` : 'Daily summary (always_send is on)',
  `Book: ${best.buy_link}`,
  `Fetched ${fetchedAt}. Fares change within minutes.`,
].join('\n');

return [{ json: {
  subject: `Fare watch: ${s.from}-${s.to} ${p} ${cur} (${best.price_range_in_relation_to_other_periods})`,
  text, price: p, currency: cur, reasons: why, buy_link: best.buy_link, fetched_at: fetchedAt,
  departure_date: best.departure_date, return_date: best.return_date,
} }];
