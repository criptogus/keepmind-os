import { createServer } from 'node:http';
const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
});
server.listen(Number(process.env.PORT), '127.0.0.1');
if (process.env.FAKE_CRASH_MS)
    setTimeout(() => process.exit(1), Number(process.env.FAKE_CRASH_MS));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
