// Node: a throw-away local web server for runner.html (headless Chrome needs http://localhost for WebCodecs
// and for module imports): /digest/* = this folder, /mediabunny.mjs = the npm bundle of this repo.
// Used by tests/digest/frames.test.mjs and by tiktok-clips/tools/digest-race.js.
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

export function serve() {
    const routes = (p) => {
        if (p === '/mediabunny.mjs') return path.join(repo, 'node_modules/mediabunny/dist/bundles/mediabunny.mjs');
        if (p.startsWith('/digest/') && !p.includes('..')) return path.join(here, p.slice(8));
        return null;
    };
    const server = createServer((req, res) => {
        const f = routes(decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!f || !existsSync(f)) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
        createReadStream(f).pipe(res);
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://localhost:${server.address().port}/digest/runner.html`,
        close: () => server.close(),
    })));
}
