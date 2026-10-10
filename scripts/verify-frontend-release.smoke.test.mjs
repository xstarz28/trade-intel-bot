import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verifierPath = fileURLToPath(new URL('./verify-frontend-release.mjs', import.meta.url));

test('published verification checks auth labels in a lazy-loaded same-origin chunk', async (t) => {
  const server = createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><link rel="stylesheet" href="/assets/index.css"></head><body><div id="root"></div><script type="module" src="/assets/index-main.js"></script></body></html>');
      return;
    }
    if (path === '/assets/index-main.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end('console.log("XSTARZG"); const loadAuth = () => import("./Auth-lazy.js");');
      return;
    }
    if (path === '/assets/Auth-lazy.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end('export const authLabels = ["Continue with Google", "Continue without an account"];');
      return;
    }
    if (path === '/assets/index.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      res.end('body { color: white; }');
      return;
    }
    if (path === '/build-info.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ commit: 'deadbeef', branch: 'main' }));
      return;
    }
    if (path === '/logo.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const target = 'http://127.0.0.1:' + address.port;
  const child = spawn(process.execPath, [
    verifierPath,
    '--url', target,
    '--expect-commit', 'deadbeef',
    '--expect-branch', 'main',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  assert.equal(outcome.code, 0, 'verification failed: ' + stderr + '\n' + stdout);
  const report = JSON.parse(stdout);
  const check = (name) => report.checks.find((item) => item.name === name);
  assert.equal(check('published JavaScript asset graph loaded')?.ok, true, stdout);
  assert.equal(check('Google auth surface')?.ok, true, stdout);
  assert.equal(check('guest auth surface')?.ok, true, stdout);
  assert.equal(check('published CSS assets loaded')?.ok, true, stdout);
});
