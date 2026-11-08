// Runs kaggle/polish.py on Kaggle's free GPU and fetches the result.
//   node kaggle.mjs push <drafts.json>         -> prints the run id
//   node kaggle.mjs wait <run id> [maxMinutes] -> data/kaggle/quiz-<run>.json (+ log)
// Token: ~/.kaggle/access_token (never printed). Reuses the kernel slug "whisper-transcribe": new slugs' GPU runs
// stayed queued forever; Дружок uses the same slug, so push refuses while a run is going on.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const USER = 'kimalexandermontreal';
const SLUG = process.env.KAGGLE_SLUG || 'whisper-transcribe';
const TOKEN = readFileSync(join(homedir(), '.kaggle', 'access_token'), 'utf8').trim();

async function api(method, body) {
  const res = await fetch(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json.error) throw new Error(`${method} ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'push') {
  const status = await api('GetKernelSessionStatus', { userName: USER, kernelSlug: SLUG }).catch((e) => ({ error: e.message }));
  console.log('current run:', JSON.stringify(status));
  if (['RUNNING', 'QUEUED'].includes(status.status)) throw new Error(`${SLUG} is busy (maybe Дружок's job) - try later`);
  const run = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const drafts = gzipSync(readFileSync(a1)).toString('base64');
  const text = readFileSync(join(HERE, 'kaggle', 'polish.py'), 'utf8').replace(/\r\n/g, '\n')
    .replace('RUN_ID = "__RUN_ID__"', `RUN_ID = "${run}"`).replace('"__DRAFTS__"', `"${drafts}"`);
  if (text.includes('__RUN_ID__') || text.includes('__DRAFTS__')) throw new Error('placeholders left in polish.py');
  const r = await api('SaveKernel', {
    slug: `${USER}/${SLUG}`, newTitle: SLUG, text, language: 'python', kernelType: 'script', isPrivate: true,
    enableGpu: true, enableInternet: true, datasetDataSources: [],
  });
  console.log('pushed', JSON.stringify(r), 'run', run);
} else if (cmd === 'wait') {
  const want = `quiz-${a1}.json`;
  const deadline = Date.now() + (Number(a2) || 90) * 60000;
  const out = join(HERE, 'data', 'kaggle');
  mkdirSync(out, { recursive: true });
  for (;;) {
    const o = await api('ListKernelSessionOutput', { userName: USER, kernelSlug: SLUG, pageSize: 50 }).catch((e) => ({ error: e.message }));
    const names = (o.files ?? []).map((f) => f.fileName);
    const status = await api('GetKernelSessionStatus', { userName: USER, kernelSlug: SLUG }).catch(() => ({}));
    console.log(new Date().toTimeString().slice(0, 5), status.status ?? '?', names.join(',') || '-', o.error ?? '');
    const failed = /Traceback/.test(o.log ?? '') || ['ERROR', 'CANCEL_ACKNOWLEDGED'].includes(status.status);
    if (names.includes(want) || failed) {
      for (const f of o.files ?? []) if (f.fileName === want) writeFileSync(join(out, want), Buffer.from(await (await fetch(f.url)).arrayBuffer()));
      if (o.log) writeFileSync(join(out, `quiz-${a1}.log.json`), o.log);
      console.log(names.includes(want) ? `saved data/kaggle/${want}` : 'FAILED, see the log');
      process.exit(names.includes(want) ? 0 : 1);
    }
    if (Date.now() > deadline) { console.log('timeout'); process.exit(2); }
    await new Promise((r) => setTimeout(r, 60000));
  }
} else {
  console.log('usage: node kaggle.mjs push <drafts.json> | wait <run id> [maxMinutes]');
}
