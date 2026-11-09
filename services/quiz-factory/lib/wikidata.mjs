// Wikidata SPARQL with an on-disk cache (data/cache/<sha1>.json), so re-runs of the builder cost nothing.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cache');
const UA = 'mao-dao-quiz-factory/0.1 (https://mao-dao.com)';

async function wdqs(query, { fresh = false } = {}) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, createHash('sha1').update(query).digest('hex') + '.json');
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query }),
      });
    } catch (e) { // the server drops the connection of a query it kills
      if (attempt >= 3) throw new Error(`SPARQL: connection lost (${e.cause?.code ?? e.message}): ${query.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    // a query that hits the 60 s limit comes back as 200 with JSON cut off and the error text inside
    let body = '';
    try { body = res.ok ? await res.text() : ''; } catch (e) { // the connection dropped while reading
      if (attempt >= 3) throw new Error('SPARQL: connection lost while reading: ' + query.slice(0, 120));
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    let parsed = null;
    try { parsed = res.ok ? JSON.parse(body) : null; } catch { if (attempt >= 3) throw new Error('SPARQL: truncated answer (query timeout): ' + query.slice(0, 120)); }
    if (parsed) {
      const rows = parsed.results.bindings.map((b) =>
        Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.type === 'uri' ? v.value.replace('http://www.wikidata.org/entity/', '') : v.value])));
      writeFileSync(file, JSON.stringify(rows));
      return rows;
    }
    if (attempt >= 4 || ![200, 429, 500, 502, 503, 504].includes(res.status)) throw new Error(`SPARQL ${res.status}: ${(body || await res.text()).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
}

/** a real Russian label: present (not the Q-id fallback), no Latin-only stub, not too long for an answer button */
export const goodLabel = (s, max = 32) => typeof s === 'string' && !/^Q\d+$/.test(s) && /[А-Яа-яЁё]/.test(s) && s.length <= max && !/[()]/.test(s);

// QLever (qlever.dev): the same Wikidata, answers in a second where WDQS hits its 60 s limit (all politicians with
// 30+ articles). QF_QLEVER=1 asks it first; otherwise it is the fallback when WDQS gives up.
const PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#> PREFIX p: <http://www.wikidata.org/prop/> PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX psv: <http://www.wikidata.org/prop/statement/value/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
`;
async function qlever(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://qlever.dev/api/wikidata', { method: 'POST', signal: AbortSignal.timeout(300000),
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query: PREFIXES + query }) });
      const body = await res.text();
      if (!res.ok) throw new Error(`QLever ${res.status}: ${body.slice(0, 300)}`);
      return JSON.parse(body).results.bindings.map((b) =>
        Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.type === 'uri' ? v.value.replace('http://www.wikidata.org/entity/', '') : v.value])));
    } catch (e) {
      if (attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 15000 * attempt));
    }
  }
}

export async function sparql(query, opt = {}) {
  const file = join(CACHE, createHash('sha1').update(query).digest('hex') + '.json');
  if (!opt.fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  mkdirSync(CACHE, { recursive: true });
  if (process.env.QF_QLEVER) {
    try { const rows = await qlever(query); writeFileSync(file, JSON.stringify(rows)); return rows; } catch (e) { console.error('QLever failed, WDQS:', e.message.slice(0, 120)); }
    return wdqs(query, opt);
  }
  try { return await wdqs(query, opt); } catch (e) {
    console.error('WDQS failed, QLever:', e.message.slice(0, 120));
    const rows = await qlever(query);
    writeFileSync(file, JSON.stringify(rows));
    return rows;
  }
}
