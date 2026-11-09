import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
export function providerHandler(state = { calls: 0 }) {
    return async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url === '/__calls')
            return res.end(JSON.stringify({ calls: state.calls }));
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
            for await (const _ of req) {
            }
            state.calls++;
            return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Mock research result for human review.' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
        }
        res.statusCode = 404;
        res.end('{}');
    };
}
export async function startMockProvider() {
    const state = { calls: 0 };
    const server = createServer(providerHandler(state));
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return { server, port: server.address().port, state, close: () => new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const s = await startMockProvider();
    console.log(JSON.stringify({ port: s.port }));
}
