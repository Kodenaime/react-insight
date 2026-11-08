import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const serverPath = fileURLToPath(
  new URL('../packages/mcp-server/dist/cli.js', import.meta.url),
);

const child = spawn(process.execPath, [serverPath, '--allow-sensitive'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
let nextId = 1;
const pending = new Map();

child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      // Ignore malformed/partial lines.
    }
  }
});

function request(method, params) {
  return new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

await request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'react-insight-probe', version: '0.0.0' },
});
await new Promise(r => setTimeout(r, 150));

const toolsList = await request('tools/list', {});
console.log('TOOLS:', JSON.stringify(toolsList.result?.tools?.map(t => t.name)));

const calls = [
  ['get_health_score', {}],
  ['list_wasted_renders', {}],
  ['get_component_diagnostics', { name: 'App' }],
  ['get_masked_report', {}],
];

for (const [name, args] of calls) {
  const res = await request('tools/call', { name, arguments: args });
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(res, null, 2));
}

child.kill();
