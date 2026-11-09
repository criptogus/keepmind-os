#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'login') { process.exitCode = process.env.HOME?.includes('logged-out') ? 1 : 0; }
else {
    const prompt = readFileSync(0, 'utf8');
    if (prompt.includes('FAKE_HANG')) setInterval(() => {}, 1000);
    else if (prompt.includes('FAKE_ERROR')) { console.error('private error'); process.exitCode = 1; }
    else {
        console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Fake Codex result' } }));
        console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } }));
    }
}
