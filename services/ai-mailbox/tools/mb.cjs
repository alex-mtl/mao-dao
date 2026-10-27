#!/usr/bin/env node
// Claude's side of the AI mailbox. Address and token live outside the repo:
//   ~/.ai-mailbox/url            https://....lambda-url.us-east-1.on.aws
//   ~/.ai-mailbox/claude.token   the token (never print it)
// Usage:
//   node mb.cjs task "<title>" <body file | ->     new task; prints its id
//   node mb.cjs say T-0001 <kind> "<text>" [local file...]   answer | instruction | thanks | cancel; the files go
//                                                 to the exchange folder first (thanks / cancel clear the task's folder)
//   node mb.cjs get T-0001 <local dir>             download Druzhok's files of the task, then delete them there
//   node mb.cjs inbox                              new messages from Druzhok + open tasks
//   node mb.cjs show T-0001                        a task with all its messages
//   node mb.cjs tasks [open|closed|all]
//   node mb.cjs stats [days]
//   node mb.cjs watch                              waits (long poll); exits on a result / question, a task stalled 15 min,
//                                                 nothing open, or after 60 min; meant for a background run
const fs = require('fs'), path = require('path'), os = require('os');
const dir = path.join(os.homedir(), '.ai-mailbox');
const url = fs.readFileSync(path.join(dir, 'url'), 'utf8').trim().replace(/\/$/, '');
const token = fs.readFileSync(path.join(dir, 'claude.token'), 'utf8').trim();

async function api(method, p, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url + p, {
        method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json();
      if (r.status === 429 && attempt < 3) { await new Promise(s => setTimeout(s, 5000)); continue; }
      if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(data.error || data)}`);
      return data;
    } catch (e) {
      if (attempt >= 3 || /^\d{3} /.test(e.message)) throw e;
      await new Promise(s => setTimeout(s, 3000));
    }
  }
}

const out = x => console.log(JSON.stringify(x, null, 1));
const fmt = m => `#${m.seq} ${m.task_id} ${m.from}/${m.kind} ${m.created_at}` +
  (m.phase ? ` [${m.phase}${m.percent != null ? ' ' + m.percent + '%' : ''}]` : '') +
  `\n${m.text}` + (m.files ? '\nfiles: ' + m.files.map(f => `${f.path} (${f.size} B)`).join(', ') : '');
const taskLine = t => `${t.id} ${t.status}${t.stalled ? ' STALLED' : ''} «${t.title}»` +
  (t.phase ? ` — ${t.phase}` : '') + (t.percent != null ? ` ${t.percent}%` : '') +
  (t.last_ping_at ? ` (ping ${t.last_ping_at})` : '');

// the exchange folder on aws-dev (see ../API.md, "Файлы")
const HOST = 'aws-dev', EX = '/srv/ai-exchange/files';
const { execFileSync } = require('child_process');
const ssh = cmd => execFileSync('ssh', [HOST, cmd], { encoding: 'utf8' });
const safeId = id => { if (!/^T-\d{4,}$/.test(id)) throw new Error('bad task id ' + id); return id; };

function upload(tid, local) {
  const name = path.basename(local), dirOnServer = `${EX}/${safeId(tid)}/claude`;
  if (!/^[\w.\- ]{1,200}$/.test(name)) throw new Error('rename the file: ' + name);
  const buf = fs.readFileSync(local);
  ssh(`install -d -m 2770 ${dirOnServer}`);
  execFileSync('scp', ['-q', local, `${HOST}:${dirOnServer}/${name}`]);
  return { path: `${tid}/claude/${name}`, size: buf.length,
           sha256: require('crypto').createHash('sha256').update(buf).digest('hex') };
}

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'task') {
    const body = a[1] === '-' || !a[1] ? fs.readFileSync(0, 'utf8') : fs.readFileSync(a[1], 'utf8');
    const r = await api('POST', '/v1/tasks', { title: a[0], body });
    console.log(r.task.id);
  } else if (cmd === 'say') {
    const r = await api('POST', `/v1/tasks/${a[0]}/messages`,
      { kind: a[1], text: a[2] || '', ...(a.length > 3 ? { files: a.slice(3).map(f => upload(a[0], f)) } : {}) });
    console.log(`#${r.message.seq} -> ${r.task.id} ${r.task.status}`);
    if (a[1] === 'thanks' || a[1] === 'cancel') ssh(`sudo rm -rf ${EX}/${safeId(a[0])}`);
  } else if (cmd === 'get') {
    const tid = safeId(a[0]), dest = a[1];
    if (!dest) throw new Error('give a local folder');
    const files = ssh(`cd ${EX}/${tid}/druzhok 2>/dev/null && find . -type f || true`).split('\n').filter(Boolean);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const to = path.join(dest, f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      execFileSync('scp', ['-q', `${HOST}:"${EX}/${tid}/druzhok/${f.slice(2)}"`, to]);
      console.log(to, fs.statSync(to).size, 'B');
    }
    if (files.length) ssh(`sudo rm -rf ${EX}/${tid}/druzhok`);
    else console.log('no files');
  } else if (cmd === 'inbox') {
    const r = await api('GET', '/v1/inbox');
    r.messages.forEach(m => console.log(fmt(m) + '\n'));
    r.open_tasks.forEach(t => console.log(taskLine(t)));
    if (!r.open_tasks.length) console.log('no open tasks');
  } else if (cmd === 'show') {
    const r = await api('GET', '/v1/tasks/' + a[0]);
    console.log(taskLine(r) + '\n');
    r.messages.forEach(m => console.log(fmt(m) + '\n'));
  } else if (cmd === 'tasks') {
    (await api('GET', '/v1/tasks?status=' + (a[0] || 'open'))).tasks.forEach(t => console.log(taskLine(t)));
  } else if (cmd === 'stats') {
    out(await api('GET', '/v1/stats?days=' + (a[0] || 7)));
  } else if (cmd === 'watch') {
    // every wake-up of Claude re-reads its whole context, so wake only when there is something to act on:
    // a result or a question, a task stalled for STALL_MIN, nothing open any more, or MAX_MIN passed;
    // ack / progress are collected and shown at the wake-up
    const STALL_MIN = 15, MAX_MIN = 60, started = Date.now(), stalledSince = new Map(), got = [];
    for (;;) {
      const r = await api('GET', '/v1/inbox?wait=25');
      got.push(...r.messages);
      r.open_tasks.forEach(t => t.stalled ? stalledSince.has(t.id) || stalledSince.set(t.id, Date.now()) : stalledSince.delete(t.id));
      const longStall = [...stalledSince.values()].some(t0 => Date.now() - t0 > STALL_MIN * 60e3);
      if (r.messages.some(m => m.kind === 'result' || m.kind === 'question') || longStall || !r.open_tasks.length
          || Date.now() - started > MAX_MIN * 60e3) {
        got.forEach(m => console.log(fmt(m) + '\n'));
        r.open_tasks.forEach(t => console.log(taskLine(t)));
        if (!r.open_tasks.length) console.log('no open tasks');
        return;
      }
    }
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n'));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
