// 直接加载请求入口，控制请求完成顺序，验证退出/换号期间的会话隔离。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/api/client.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const unauthorized = () => Response.json({ error: { code: 'unauthorized' } }, { status: 401 });
let sequence = 0;
let passed = 0;

async function run(name, test) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.location = { origin: 'http://localhost', pathname: '/projects', href: '' };
  const client = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${++sequence}`);
  await test(client);
  passed++;
  console.log(`PASS ${name}`);
}

await run('并发 401 共享一次刷新并保留会话标识', async (client) => {
  client.setTokens('old', 'refresh-old');
  const session = client.getSessionId();
  const gate = deferred();
  const started = deferred();
  let refreshCount = 0;
  globalThis.fetch = async (path, init) => {
    if (path === '/api/auth/refresh') {
      refreshCount++;
      started.resolve();
      return gate.promise;
    }
    return init.headers.get('Authorization') === 'Bearer old' ? unauthorized() : Response.json({ ok: true });
  };
  const first = client.api('/api/me');
  const second = client.api('/api/projects');
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCount, 1);
  gate.resolve(Response.json({ token: 'new', refreshToken: 'refresh-new' }));
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.equal(client.getSessionId(), session);
});

await run('退出期间完成的刷新不能恢复登录，且吊销悬空凭证', async (client) => {
  client.setTokens('old', 'refresh-old');
  const gate = deferred();
  const started = deferred();
  const revoked = [];
  globalThis.fetch = async (path, init) => {
    if (path === '/api/auth/refresh') { started.resolve(); return gate.promise; }
    if (path === '/api/auth/logout') { revoked.push(JSON.parse(init.body).refreshToken); return Response.json({ ok: true }); }
    return unauthorized();
  };
  const pending = client.api('/api/me').catch((error) => error);
  await started.promise;
  client.setTokens(null, null);
  gate.resolve(Response.json({ token: 'new', refreshToken: 'refresh-new' }));
  assert.equal((await pending).name, 'AbortError');
  assert.equal(client.getToken(), null);
  assert.equal(localStorage.getItem('anon-refresh-token'), null);
  assert.deepEqual(revoked, ['refresh-new']);
});

await run('切换账号后旧刷新不能覆盖新凭证', async (client) => {
  client.setTokens('account-a', 'refresh-a');
  const gate = deferred();
  const started = deferred();
  globalThis.fetch = async (path) => {
    if (path === '/api/auth/refresh') { started.resolve(); return gate.promise; }
    return unauthorized();
  };
  const pending = client.api('/api/me').catch((error) => error);
  await started.promise;
  client.setTokens('account-b', 'refresh-b');
  gate.resolve(Response.json({ token: 'renewed-a', refreshToken: 'renewed-refresh-a' }));
  assert.equal((await pending).name, 'AbortError');
  assert.equal(client.getToken(), 'account-b');
  assert.equal(localStorage.getItem('anon-refresh-token'), 'refresh-b');
});

for (const status of [200, 401]) {
  await run(`换号后丢弃旧请求的 ${status} 响应`, async (client) => {
    client.setTokens('account-a', 'refresh-a');
    const gate = deferred();
    let count = 0;
    globalThis.fetch = async () => { count++; return gate.promise; };
    const pending = client.api('/api/me').catch((error) => error);
    client.setTokens('account-b', 'refresh-b');
    gate.resolve(Response.json({ user: 'account-a' }, { status }));
    assert.equal((await pending).name, 'AbortError');
    assert.equal(count, 1);
    assert.equal(client.getToken(), 'account-b');
    assert.equal(location.href, '');
  });
}

await run('JSON 读取期间切换账号也丢弃旧数据', async (client) => {
  client.setTokens('account-a', 'refresh-a');
  const body = deferred();
  const reading = deferred();
  const response = Response.json({});
  response.json = () => { reading.resolve(); return body.promise; };
  globalThis.fetch = async () => response;
  const pending = client.api('/api/me').catch((error) => error);
  await reading.promise;
  client.setTokens('account-b', 'refresh-b');
  body.resolve({ user: 'account-a' });
  assert.equal((await pending).name, 'AbortError');
});

await run('较晚到达的旧 401 复用已刷新的令牌', async (client) => {
  client.setTokens('old', 'refresh-old');
  const late = deferred();
  let refreshCount = 0;
  globalThis.fetch = async (path, init) => {
    if (path === '/api/auth/refresh') { refreshCount++; return Response.json({ token: 'new', refreshToken: 'refresh-new' }); }
    if (init.headers.get('Authorization') === 'Bearer new') return Response.json({ ok: true });
    if (path === '/api/late') return late.promise;
    return unauthorized();
  };
  const pending = client.api('/api/late');
  await client.api('/api/me');
  late.resolve(unauthorized());
  assert.deepEqual(await pending, { ok: true });
  assert.equal(refreshCount, 1);
});

await run('其他标签页刷新成功后，较晚的刷新失败不能清除新凭证', async (client) => {
  client.setTokens('old', 'refresh-old');
  const gate = deferred();
  const started = deferred();
  globalThis.fetch = async (path, init) => {
    if (path === '/api/auth/refresh') { started.resolve(); return gate.promise; }
    return init.headers.get('Authorization') === 'Bearer new' ? Response.json({ ok: true }) : unauthorized();
  };
  const pending = client.api('/api/me');
  await started.promise;
  localStorage.setItem('anon-token', 'new');
  localStorage.setItem('anon-refresh-token', 'refresh-new');
  gate.resolve(unauthorized());
  assert.deepEqual(await pending, { ok: true });
  assert.equal(client.getToken(), 'new');
});

await run('拒绝外站、站内非 API 与路径绕过，且不发送请求', async (client) => {
  client.setTokens('private-token', 'private-refresh');
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({}); };
  for (const path of ['https://outside.invalid/api/me', '//outside.invalid/api/me', '/login', '/api/../login', 'http://user:pass@localhost/api/me']) {
    await assert.rejects(client.authorizedFetch(path), /本站 API/);
  }
  assert.equal(count, 0);
});

await run('鉴权请求禁止缓存及自动重定向', async (client) => {
  client.setTokens('private-token', 'private-refresh');
  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/api/me');
    assert.equal(init.headers.get('Authorization'), 'Bearer private-token');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    return Response.json({ ok: true });
  };
  await client.authorizedFetch('http://localhost/api/me', { cache: 'force-cache', redirect: 'follow' });
});

await run('不带刷新凭证的新登录不会沿用前账号的刷新凭证', async (client) => {
  client.setTokens('account-a', 'refresh-a');
  const previous = client.getSessionId();
  client.setTokens('demo');
  assert.equal(localStorage.getItem('anon-refresh-token'), null);
  assert.notEqual(client.getSessionId(), previous);
});

await run('升级前已有的登录态自动补齐会话标识', async (client) => {
  localStorage.setItem('anon-token', 'legacy');
  localStorage.setItem('anon-refresh-token', 'legacy-refresh');
  const session = client.getSessionId();
  assert.ok(session);
  assert.equal(client.getSessionId(), session);
  assert.equal(client.getToken(), 'legacy');
});

await run('支持 Web Locks 时两个标签页只轮换一次凭证', async (client) => {
  client.setTokens('old', 'refresh-old');
  const otherTab = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#other-tab`);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (_name, callback) => {
      const pending = tail.then(() => callback({}));
      tail = pending.catch(() => {});
      return pending;
    },
  } } });
  try {
    let refreshCount = 0;
    const gate = deferred();
    const started = deferred();
    globalThis.fetch = async (path, init) => {
      if (path === '/api/auth/refresh') { refreshCount++; started.resolve(); return gate.promise; }
      return init.headers.get('Authorization') === 'Bearer new' ? Response.json({ ok: true }) : unauthorized();
    };
    const first = client.api('/api/me');
    const second = otherTab.api('/api/projects');
    await started.promise;
    gate.resolve(Response.json({ token: 'new', refreshToken: 'refresh-new' }));
    assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
    assert.equal(refreshCount, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

console.log(`${passed}/${sequence} 通过`);
