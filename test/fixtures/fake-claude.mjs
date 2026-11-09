#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'auth') {
    console.log(JSON.stringify({ authMethod: 'claude.ai' }));
    process.exitCode = process.env.HOME?.includes('logged-out') ? 1 : 0;
} else {
    const prompt = readFileSync(0, 'utf8');
    if (prompt.includes('FAKE_HANG')) setInterval(() => {}, 1000);
    else console.log(JSON.stringify({ result: 'Fake Claude result', is_error: prompt.includes('FAKE_ERROR'), usage: { input_tokens: 10, output_tokens: 20 } }));
}
