#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DEVICE_ID = 'your-device-id';
const DEFAULT_USER_AGENT = 'Xiaoyuzhou/2.98.0 (build:2908; iOS 26.2.1)';
const AUTH_FILE = path.join(os.homedir(), '.opencli', 'xiaoyuzhou.json');

const args = parseArgs(process.argv.slice(2));
const config = {
  podcast: args.podcast || args.p || '',
  download: boolArg(args.download, false),
  yes: boolArg(args.yes || args.y, false),
  outputRoot: args.output || args.o || path.join(__dirname, 'xiaoyuzhou-output'),
  minDelayMs: numberArg(args.minDelayMs || args['min-delay-ms'], 8000),
  maxDelayMs: numberArg(args.maxDelayMs || args['max-delay-ms'], 22000),
  retries: numberArg(args.retries, 2),
  limit: numberArg(args.limit, 0),
  start: numberArg(args.start, 0),
};

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      parsed._ = [...(parsed._ || []), item];
      continue;
    }
    const [rawKey, rawValue] = item.slice(2).split('=');
    const key = rawKey.trim();
    if (rawValue !== undefined) {
      parsed[key] = rawValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  if (!parsed.podcast && parsed._?.length) {
    parsed.podcast = parsed._.join(' ');
  }
  return parsed;
}

function boolArg(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

function numberArg(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function run(command, runArgs, options = {}) {
  return new Promise((resolve) => {
    execFile(command, runArgs, {
      cwd: options.cwd || __dirname,
      timeout: options.timeout || 60_000,
      maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

function createPrompt() {
  return readline.createInterface({ input, output });
}

async function ask(question, fallback = '') {
  const rl = createPrompt();
  try {
    const suffix = fallback ? ` (${fallback})` : '';
    const answer = await rl.question(`${question}${suffix}: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function askYesNo(question, fallback = false) {
  if (config.yes) return true;
  const hint = fallback ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} [${hint}]`)).toLowerCase();
  if (!answer) return fallback;
  return ['y', 'yes', '是', '好', '1'].includes(answer);
}

async function collectMultiline(promptText) {
  console.log(promptText);
  console.log('粘贴完成后，单独输入一行 END 并回车。');
  const rl = createPrompt();
  const lines = [];
  try {
    while (true) {
      const line = await rl.question('');
      if (line.trim() === 'END') break;
      lines.push(line);
    }
  } finally {
    rl.close();
  }
  return lines.join('\n');
}

function ensureDelayConfig() {
  if (config.minDelayMs < 0 || config.maxDelayMs < config.minDelayMs) {
    throw new Error('Delay config must satisfy 0 <= minDelayMs <= maxDelayMs');
  }
}

async function checkOpencli() {
  const which = await run('which', ['opencli']);
  if (!which.ok) {
    throw new Error('未找到 opencli。请先安装 opencli，并确保 opencli 在 PATH 里。');
  }
  console.log(`opencli: ${which.stdout.trim()}`);

  const help = await run('opencli', ['--help']);
  if (!help.ok) {
    throw new Error(`opencli 无法运行:\n${help.stderr || help.stdout}`);
  }

  const xiaoyuzhouHelp = await run('opencli', ['xiaoyuzhou', '--help']);
  if (!xiaoyuzhouHelp.ok || !xiaoyuzhouHelp.stdout.includes('transcript')) {
    throw new Error('opencli xiaoyuzhou 工具不可用，或缺少 transcript 命令。');
  }
  console.log('opencli xiaoyuzhou: ok');

  const doctor = await run('opencli', ['doctor'], { timeout: 20_000 });
  if (doctor.ok) {
    console.log('opencli doctor: ok');
  } else {
    console.warn('opencli doctor 未完全通过，后续仍会尝试运行。');
    console.warn((doctor.stderr || doctor.stdout).trim());
  }
}

function parseAuthFile() {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractToken(text, name) {
  const patterns = [
    new RegExp(`${name}=([^;'\\s]+)`),
    new RegExp(`${name}:\\s*([^;'\\s]+)`, 'i'),
    new RegExp(`['"]${name}['"]\\s*:\\s*['"]([^'"]+)['"]`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function parseCredentialsFromText(text) {
  return {
    access_token: extractToken(text, 'x-jike-access-token'),
    refresh_token: extractToken(text, 'x-jike-refresh-token'),
    device_id: extractToken(text, 'x-jike-device-id') || DEFAULT_DEVICE_ID,
    device_properties: extractToken(text, 'x-jike-device-properties'),
  };
}

async function ensureCredentials() {
  const existing = parseAuthFile();
  if (existing) {
    console.log(`小宇宙 auth: ${AUTH_FILE}`);
    return existing;
  }

  console.warn(`未找到可用的小宇宙 auth 文件: ${AUTH_FILE}`);
  console.warn('你可以从浏览器开发者工具或抓包 curl 中复制包含 x-jike-access-token 的请求。');

  const shouldPaste = await askYesNo('是否现在粘贴 curl / headers / cookie，让脚本自动生成 auth 文件？', true);
  if (!shouldPaste) {
    throw new Error(`请先创建 ${AUTH_FILE}，至少包含 access_token 和 refresh_token。`);
  }

  const raw = await collectMultiline('请粘贴 curl / headers / cookie：');
  const credentials = parseCredentialsFromText(raw);
  if (!credentials.access_token || !credentials.refresh_token) {
    throw new Error('没有从粘贴内容中找到 x-jike-access-token 和 x-jike-refresh-token。');
  }

  mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  writeFileSync(AUTH_FILE, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${AUTH_FILE}`);
  return credentials;
}

function normalizePodcastId(inputValue) {
  const value = String(inputValue || '').trim();
  const urlMatch = value.match(/xiaoyuzhoufm\.com\/podcast\/([0-9a-f]{24})/i);
  if (urlMatch) return urlMatch[1];
  if (/^[0-9a-f]{24}$/i.test(value)) return value;
  return '';
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('empty JSON output');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[\[{]/);
    const endArray = trimmed.lastIndexOf(']');
    const endObject = trimmed.lastIndexOf('}');
    const end = Math.max(endArray, endObject);
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`failed to parse JSON output: ${trimmed.slice(0, 300)}`);
  }
}

async function searchPodcastByName(query) {
  console.log(`搜索播客: ${query}`);
  const searchQuery = `site:xiaoyuzhoufm.com/podcast ${query}`;
  const result = await run('opencli', ['google', 'search', searchQuery, '--limit', '10', '--lang', 'zh', '-f', 'json'], {
    timeout: 90_000,
  });
  if (!result.ok) {
    console.warn('opencli google search 失败，将要求手动输入播客 URL/ID。');
    return [];
  }

  let rows = [];
  try {
    rows = extractJson(result.stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];

  const seen = new Set();
  return rows
    .map((row) => {
      const url = String(row.url || row.link || '').trim();
      const id = normalizePodcastId(url);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        title: String(row.title || '').trim(),
        url,
        snippet: String(row.snippet || '').trim(),
      };
    })
    .filter(Boolean);
}

async function choosePodcastByName(name) {
  const candidates = await searchPodcastByName(name);
  if (!candidates.length) {
    const manual = await ask('没有找到可靠候选，请输入小宇宙播客 URL 或 ID');
    const id = normalizePodcastId(manual);
    if (!id) throw new Error('无法解析播客 ID。');
    return id;
  }

  console.log('候选播客：');
  candidates.forEach((item, index) => {
    console.log(`${index + 1}. ${item.title || item.id}`);
    console.log(`   ${item.url}`);
  });
  const choice = await ask('请选择序号，或直接输入播客 URL/ID', '1');
  const chosenIndex = Number(choice);
  if (Number.isInteger(chosenIndex) && chosenIndex >= 1 && chosenIndex <= candidates.length) {
    return candidates[chosenIndex - 1].id;
  }
  const id = normalizePodcastId(choice);
  if (!id) throw new Error('无法解析播客 ID。');
  return id;
}

async function resolvePodcastId() {
  let value = config.podcast;
  if (!value) {
    value = await ask('请输入小宇宙播客名称、主页 URL 或播客 ID');
  }

  const directId = normalizePodcastId(value);
  if (directId) return directId;
  return choosePodcastByName(value);
}

async function getPodcastInfo(podcastId) {
  const result = await run('opencli', ['xiaoyuzhou', 'podcast', podcastId, '-f', 'json'], {
    timeout: 60_000,
  });
  if (!result.ok) {
    throw new Error(`无法读取播客信息。请检查 auth 和播客 ID。\n${result.stderr || result.stdout}`);
  }
  const rows = extractJson(result.stdout);
  const podcast = Array.isArray(rows) ? rows[0] : rows;
  if (!podcast?.title) {
    throw new Error('opencli 返回的播客信息格式异常。');
  }
  return {
    id: podcastId,
    title: podcast.title,
    author: podcast.author || '',
    description: podcast.description || '',
    subscribers: podcast.subscribers,
    episodes: podcast.episodes,
    updated: podcast.updated,
  };
}

function loadCredentials() {
  const credentials = parseAuthFile();
  if (!credentials) {
    throw new Error(`无法读取小宇宙 auth 文件: ${AUTH_FILE}`);
  }
  return {
    access_token: String(credentials.access_token || '').trim(),
    refresh_token: String(credentials.refresh_token || '').trim(),
    device_id: String(credentials.device_id || credentials.deviceId || DEFAULT_DEVICE_ID).trim() || DEFAULT_DEVICE_ID,
    device_properties: String(credentials.device_properties || credentials.deviceProperties || ''),
  };
}

function buildXiaoyuzhouHeaders(credentials, includeRefreshToken = false) {
  const headers = {
    'Content-Type': 'application/json',
    Host: 'api.xiaoyuzhoufm.com',
    'User-Agent': DEFAULT_USER_AGENT,
    Market: 'AppStore',
    'App-BuildNo': '2908',
    OS: 'ios',
    Manufacturer: 'Apple',
    BundleID: 'app.podcast.cosmos',
    Accept: '*/*',
    'App-Version': '2.98.0',
    'x-jike-device-id': credentials.device_id,
    'x-jike-device-properties': credentials.device_properties,
    'x-jike-access-token': credentials.access_token,
    'Local-Time': new Date().toISOString(),
    Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
  if (includeRefreshToken) {
    headers['x-jike-refresh-token'] = credentials.refresh_token;
  }
  return headers;
}

async function refreshCredentials(credentials) {
  const response = await fetch('https://api.xiaoyuzhoufm.com/app_auth_tokens.refresh', {
    method: 'POST',
    headers: {
      ...buildXiaoyuzhouHeaders(credentials, true),
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`刷新小宇宙 auth 失败 HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text);
  const next = {
    access_token: parsed['x-jike-access-token'],
    refresh_token: parsed['x-jike-refresh-token'],
    device_id: credentials.device_id,
    device_properties: credentials.device_properties,
  };
  if (!next.access_token || !next.refresh_token) {
    throw new Error('刷新小宇宙 auth 后没有拿到新 token。');
  }
  writeFileSync(AUTH_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`小宇宙 auth 已刷新: ${AUTH_FILE}`);
  return next;
}

async function requestXiaoyuzhouJson(endpoint, body, credentials) {
  const url = new URL(endpoint, 'https://api.xiaoyuzhoufm.com').toString();
  let response = await fetch(url, {
    method: 'POST',
    headers: buildXiaoyuzhouHeaders(credentials),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 401) {
    credentials = await refreshCredentials(credentials);
    response = await fetch(url, {
      method: 'POST',
      headers: buildXiaoyuzhouHeaders(credentials),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`小宇宙 API 请求失败 HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { parsed: JSON.parse(text), credentials };
}

async function fetchAllEpisodes(podcastId) {
  let credentials = loadCredentials();
  let body = { pid: podcastId, order: 'desc', limit: 15 };
  const episodes = [];
  const seen = new Set();
  let page = 0;

  while (true) {
    page += 1;
    const response = await requestXiaoyuzhouJson('/v1/episode/list', body, credentials);
    credentials = response.credentials;
    const rows = Array.isArray(response.parsed.data) ? response.parsed.data : [];
    console.log(`节目列表 page ${page}: ${rows.length} 条`);

    for (const episode of rows) {
      if (!episode.eid || seen.has(episode.eid)) continue;
      seen.add(episode.eid);
      episodes.push({
        id: episode.eid,
        name: episode.title || '',
        date: episode.pubDate || '',
        duration: episode.duration || null,
        playCount: episode.playCount ?? null,
      });
    }

    const key = response.parsed.loadMoreKey;
    if (!key?.id || rows.length === 0) break;
    body = {
      pid: podcastId,
      order: 'desc',
      limit: 15,
      loadMoreKey: key,
    };
    if (page > 100) {
      throw new Error('翻页超过 100 页，停止以避免异常循环。');
    }
  }

  return episodes;
}

function slugify(text) {
  return String(text || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'podcast';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs() {
  const range = config.maxDelayMs - config.minDelayMs;
  return config.minDelayMs + Math.floor(Math.random() * (range + 1));
}

function runOpencliTranscript(episode, transcriptsDir) {
  return new Promise((resolve) => {
    const child = spawn('opencli', [
      'xiaoyuzhou',
      'transcript',
      episode.id,
      '--output',
      transcriptsDir,
      '--json',
      'true',
      '--text',
      'false',
      '-f',
      'json',
    ], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function transcriptPath(transcriptsDir, episodeId) {
  return path.join(transcriptsDir, episodeId, 'transcript.json');
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function downloadOneTranscript(episode, index, total, transcriptsDir) {
  const jsonPath = transcriptPath(transcriptsDir, episode.id);
  if (existsSync(jsonPath)) {
    console.log(`[${index + 1}/${total}] skip existing ${episode.id} ${episode.name}`);
    return { status: 'skipped', episode, jsonPath };
  }

  for (let attempt = 1; attempt <= config.retries + 1; attempt += 1) {
    console.log(`[${index + 1}/${total}] download attempt ${attempt} ${episode.id} ${episode.name}`);
    const result = await runOpencliTranscript(episode, transcriptsDir);
    if (result.code === 0 && existsSync(jsonPath)) {
      console.log(`[${index + 1}/${total}] ok ${jsonPath}`);
      return { status: 'ok', episode, jsonPath };
    }

    const error = `${result.stderr}\n${result.stdout}`.trim();
    if (attempt <= config.retries) {
      const delay = randomDelayMs();
      console.warn(`[${index + 1}/${total}] failed, retry in ${Math.round(delay / 1000)}s: ${error.slice(0, 500)}`);
      await sleep(delay);
      continue;
    }
    console.error(`[${index + 1}/${total}] failed permanently: ${error.slice(0, 1000)}`);
    return { status: 'failed', episode, error };
  }
}

async function downloadTranscripts(episodes, paths) {
  const selected = episodes.slice(
    config.start,
    config.limit > 0 ? config.start + config.limit : undefined,
  );
  const state = {
    startedAt: new Date().toISOString(),
    output: paths.baseDir,
    transcriptsDir: paths.transcriptsDir,
    totalAvailable: episodes.length,
    totalSelected: selected.length,
    minDelayMs: config.minDelayMs,
    maxDelayMs: config.maxDelayMs,
    retries: config.retries,
    ok: [],
    skipped: [],
    failed: [],
  };

  writeJson(paths.runState, state);
  console.log(`准备下载 ${selected.length}/${episodes.length} 期 transcript`);
  console.log(`随机间隔: ${config.minDelayMs}-${config.maxDelayMs} ms`);

  for (let i = 0; i < selected.length; i += 1) {
    const absoluteIndex = config.start + i;
    const result = await downloadOneTranscript(selected[i], absoluteIndex, episodes.length, paths.transcriptsDir);
    state[result.status].push(result);
    writeJson(paths.runState, state);
    writeJson(paths.failed, state.failed.map((item) => item.episode));

    if (i < selected.length - 1) {
      const delay = randomDelayMs();
      console.log(`wait ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }

  state.finishedAt = new Date().toISOString();
  writeJson(paths.runState, state);
  writeJson(paths.failed, state.failed.map((item) => item.episode));
  return state;
}

function printUsage() {
  console.log(`
Usage:
  node xiaoyuzhou-podcast-transcripts.mjs
  node xiaoyuzhou-podcast-transcripts.mjs --podcast <name|url|id> --download

Options:
  --podcast <value>       小宇宙播客名称、主页 URL 或 24 位播客 ID
  --download              拉取节目清单后直接下载所有 transcript
  --yes                   非交互确认 yes
  --output <dir>          输出根目录，默认 ./xiaoyuzhou-output
  --min-delay-ms <n>      下载间隔下限，默认 8000
  --max-delay-ms <n>      下载间隔上限，默认 22000
  --retries <n>           单期失败重试次数，默认 2
  --start <n>             从第 n 条开始下载，默认 0
  --limit <n>             只下载 n 条，默认 0 表示全部
`);
}

async function main() {
  if (args.help || args.h) {
    printUsage();
    return;
  }
  ensureDelayConfig();

  console.log('== 环境检查 ==');
  await checkOpencli();
  await ensureCredentials();

  console.log('\n== 播客解析 ==');
  const podcastId = await resolvePodcastId();
  const podcast = await getPodcastInfo(podcastId);
  console.log(`播客: ${podcast.title}`);
  console.log(`作者: ${podcast.author || '-'}`);
  console.log(`opencli 显示节目数: ${podcast.episodes ?? '-'}`);

  const baseDir = path.join(config.outputRoot, `${slugify(podcast.title)}-${podcast.id}`);
  const paths = {
    baseDir,
    episodes: path.join(baseDir, 'episodes.json'),
    podcast: path.join(baseDir, 'podcast.json'),
    failed: path.join(baseDir, 'failed.json'),
    runState: path.join(baseDir, 'run-state.json'),
    transcriptsDir: path.join(baseDir, 'transcripts'),
  };
  mkdirSync(paths.transcriptsDir, { recursive: true });
  writeJson(paths.podcast, podcast);

  console.log('\n== 拉取节目清单 ==');
  const episodes = await fetchAllEpisodes(podcast.id);
  writeJson(paths.episodes, { podcast, count: episodes.length, episodes });
  console.log(`节目清单已保存: ${paths.episodes}`);
  console.log(`实际拉取节目数: ${episodes.length}`);

  const shouldDownload = config.download || (!config.yes && await askYesNo('是否下载所有 transcript JSON？', false));
  if (!shouldDownload) {
    console.log('已跳过 transcript 下载。');
    console.log(`输出目录: ${baseDir}`);
    return;
  }

  console.log('\n== 下载 transcript ==');
  const state = await downloadTranscripts(episodes, paths);
  const summary = {
    output: baseDir,
    transcriptsDir: paths.transcriptsDir,
    episodes: episodes.length,
    ok: state.ok.length,
    skipped: state.skipped.length,
    failed: state.failed.length,
    failedEpisodes: state.failed.map((item) => item.episode),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (state.failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
