require('dotenv').config();

const http = require('http');
const mediasoup = require('mediasoup');
const { WebSocketServer } = require('ws');
const { dispatch, handleClose } = require('./lib/signaling');

const PORT = Number(process.env.PORT) || 8381;

async function main() {
    if (!process.env.SHARED_SECRET) {
        console.error('SHARED_SECRET is not set — refusing to start (see .env.example)');
        process.exit(1);
    }

    // A single worker/router for the whole process, shared by every
    // room — matching ttl10's own setup exactly (see the research
    // summary this service was built from). Plain Opus + VP8, no RTX/
    // NACK feedback params, no STUN/TURN: mediasoup's own UDP/TCP
    // transport with an announced public IP is what ttl10 runs in
    // production too.
    const worker = await mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: Number(process.env.RTC_MIN_PORT) || 40000,
        rtcMaxPort: Number(process.env.RTC_MAX_PORT) || 40100,
    });

    worker.on('died', () => {
        console.error('mediasoup worker died — exiting so the process supervisor restarts us');
        process.exit(1);
    });

    const router = await worker.createRouter({
        mediaCodecs: [
            { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
            { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
        ],
    });

    const httpServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('mafia-media-sfu ok');
    });

    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
        ws.on('message', async (raw) => {
            let data;
            try {
                data = JSON.parse(raw.toString());
            } catch {
                return;
            }

            try {
                await dispatch(ws, router, data);
            } catch (error) {
                console.error(`Error handling "${data.type}":`, error);
                if (data.requestId) {
                    ws.send(JSON.stringify({
                        type: 'request-response',
                        requestId: data.requestId,
                        status: false,
                        error: error.message,
                    }));
                }
            }
        });

        ws.on('close', () => handleClose(ws));
    });

    httpServer.listen(PORT, () => {
        console.log(`mafia-media-sfu listening on :${PORT}`);
    });
}

main().catch((error) => {
    console.error('Failed to start mafia-media-sfu:', error);
    process.exit(1);
});
