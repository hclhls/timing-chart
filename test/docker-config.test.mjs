// Docker configuration contract tests: `node --test test/docker-config.test.mjs`
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
const dockerignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8')
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8')
const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
const readConfig = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const hasTarget = (name) => new RegExp(`^FROM\\s+.+\\s+AS\\s+${name}\\s*$`, 'im').test(dockerfile)
const hasIgnoreEntry = (entry) =>
  dockerignore.split(/\r?\n/).some((line) => line.trim() === entry)

const serviceNames = (compose) => {
  const services = compose.split(/^services:\s*$/m)[1]?.split(/^networks:\s*$/m)[0] ?? ''
  return [...services.matchAll(/^  ([a-z][\w-]*):\s*$/gm)].map(([, name]) => name)
}

test('Dockerfile defines web and api build targets', () => {
  assert.equal(hasTarget('web'), true)
  assert.equal(hasTarget('api'), true)
})

test('web target builds at the container root and uses an unprivileged Nginx runtime on 8080', () => {
  assert.match(dockerfile, /RUN\s+BASE_PATH=\/\s+npm run build/)
  const webSection = dockerfile
    .split(/^FROM\s+/im)
    .find((section) => /^nginxinc\/nginx-unprivileged:.*\sAS\s+web\s*$/im.test(section.split(/\r?\n/, 1)[0]))
  assert.ok(webSection, 'unprivileged Nginx web runtime target is missing')
  assert.match(webSection, /COPY\s+--from=web-build\s+\/app\/dist\s+\/usr\/share\/nginx\/html/)
  assert.match(webSection, /COPY\s+docker\/nginx\.conf\s+\/etc\/nginx\/conf\.d\/default\.conf/)
  assert.match(webSection, /EXPOSE\s+8080\b/)
})

test('api target runs the API server as the non-root Node user and exposes port 51124', () => {
  const apiSection = dockerfile
    .split(/^FROM\s+/im)
    .find((section) => /^node:22.*\sAS\s+api\s*$/im.test(section.split(/\r?\n/, 1)[0]))
  assert.ok(apiSection, 'Node 22 API runtime target is missing')
  assert.match(apiSection, /EXPOSE\s+51124\b/)
  assert.match(apiSection, /CMD\s+\[\s*["']node["']\s*,\s*["']api\/server\.mjs["']\s*\]/)
  assert.match(apiSection, /USER\s+node\b/)
})

test('Docker context excludes dependencies, build output, secrets, tests, and planning files', () => {
  for (const entry of ['node_modules', 'dist', '.git', '.env', '.env.*', 'test/_bundles', '.superpowers']) {
    assert.equal(hasIgnoreEntry(entry), true, `${entry} must be excluded from the Docker context`)
  }
})

test('Dockerfile does not bake AI credentials or runtime settings into image layers', () => {
  assert.doesNotMatch(dockerfile, /^(?:ARG|ENV)\s+AI_/im)
  assert.doesNotMatch(dockerfile, /(?:AI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)/)
})

test('Nginx serves the SPA fallback, proxies API requests, and listens on 8080', async () => {
  const nginx = await readConfig('docker/nginx.conf')

  assert.match(nginx, /root\s+\/usr\/share\/nginx\/html\s*;/)
  assert.match(nginx, /listen\s+8080\s*;/)
  assert.match(nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/)
  assert.match(nginx, /location\s+\/api\/\s*\{[\s\S]*?proxy_pass\s+http:\/\/api:51124\s*;/)
  assert.match(nginx, /proxy_set_header\s+Host\s+\$http_host\s*;/)
  assert.match(nginx, /proxy_set_header\s+Origin\s+\$http_origin\s*;/)
})

test('Compose exposes only the web service on its unprivileged runtime port and keeps AI settings in the API runtime', async () => {
  const compose = await readConfig('compose.yaml')
  const web = compose.split(/^  web:\s*$/m)[1]?.split(/^  api:\s*$/m)[0] ?? ''
  const api = compose.split(/^  api:\s*$/m)[1]?.split(/^networks:\s*$/m)[0] ?? ''

  assert.match(compose, /^services:\s*$/m)
  assert.match(web, /^\s+ports:\s*\n\s+-\s+['"]?8080:8080['"]?\s*$/m)
  assert.doesNotMatch(api, /^\s+ports:\s*$/m)
  assert.match(api, /^\s+environment:\s*$/m)
  for (const name of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL']) {
    assert.match(api, new RegExp(`^\\s+${name}:\\s*$`, 'm'))
    assert.doesNotMatch(web, new RegExp(`^\\s+${name}:`, 'm'))
  }
  assert.match(api, /^\s+AI_HOST:\s+0\.0\.0\.0\s*$/m)
})

test('Compose keeps the API private on a shared network and uses HTTP health checks', async () => {
  const compose = await readConfig('compose.yaml')
  const web = compose.split(/^  web:\s*$/m)[1]?.split(/^  api:\s*$/m)[0] ?? ''
  const api = compose.split(/^  api:\s*$/m)[1]?.split(/^networks:\s*$/m)[0] ?? ''

  assert.match(web, /^\s+networks:\s*\n\s+-\s+app\s*$/m)
  assert.match(api, /^\s+networks:\s*\n\s+-\s+app\s*$/m)
  assert.match(compose, /^networks:\s*\n\s+app:\s*\n\s+driver:\s+bridge\s*$/m)
  assert.match(web, /healthcheck:[\s\S]*?http:\/\/127\.0\.0\.1:8080\//)
  assert.match(api, /healthcheck:[\s\S]*?http:\/\/127\.0\.0\.1:51124\/health/)
})

test('production Compose defines exactly web and api services', async () => {
  const compose = await readConfig('compose.yaml')
  assert.deepEqual(serviceNames(compose).sort(), ['api', 'web'])
})

test('development Compose runs Vite with source and dependency mounts', async () => {
  const compose = await readConfig('compose.dev.yaml')
  const web = compose.split(/^  web:\s*$/m)[1]?.split(/^  bridge:\s*$/m)[0] ?? ''

  assert.match(web, /^\s+target:\s+web-build\s*$/m)
  assert.match(web, /^\s+command:\s+npm run dev -- --host 0\.0\.0\.0\s*$/m)
  assert.match(web, /^\s+BASE_PATH:\s+\/\s*$/m)
  assert.match(web, /^\s+ports:(?:\s+!override)?\s*\n\s+-\s+['"]?5173:5173['"]?\s*$/m)
  assert.match(web, /^\s+volumes:\s*\n\s+-\s+\.:\/app\s*\n\s+-\s+\/app\/node_modules\s*$/m)
  assert.match(web, /healthcheck:[\s\S]*?5173/)
})

test('development Compose targets the API service and gates the bridge behind the dev profile', async () => {
  const compose = await readConfig('compose.dev.yaml')
  const web = compose.split(/^  web:\s*$/m)[1]?.split(/^  bridge:\s*$/m)[0] ?? ''
  const bridge = compose.split(/^  bridge:\s*$/m)[1] ?? ''

  assert.match(web, /^\s+VITE_API_PROXY_TARGET:\s+http:\/\/api:51124\s*$/m)
  assert.match(bridge, /^\s+command:\s+npm run bridge\s*$/m)
  assert.match(bridge, /^\s+BRIDGE_HOST:\s+0\.0\.0\.0\s*$/m)
  assert.doesNotMatch(web, /^\s+BRIDGE_HOST:/m)
  assert.match(bridge, /^\s+profiles:\s+\['dev'\]\s*$/m)
  assert.match(bridge, /^\s+ports:\s*\n\s+-\s+['"]?127\.0\.0\.1:51123:51123['"]?\s*$/m)
})

test('.gitignore ignores local environment files while retaining the example file', () => {
  for (const entry of ['.env', '.env.*', '!.env.example']) {
    assert.match(gitignore, new RegExp(`^${entry.replace(/\./g, '\\.')}$`, 'm'))
  }
})

test('Vite uses an overridable API proxy target with a local default', () => {
  assert.match(viteConfig, /process\.env\.VITE_API_PROXY_TARGET\s*\?\?\s*'http:\/\/localhost:51124'/)
  assert.match(viteConfig, /'\/api':\s*apiProxyTarget/)
})
