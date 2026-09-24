import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const historyPath = join(root, 'data', 'question-history.txt');
// decision.mjs 与 roles.json 每次请求按 mtime 热重载:改完文件立即生效,无需重启
const decisionPath = join(root, 'decision.mjs');
const rolesPath = join(root, 'roles.json');
let decision = await import('./decision.mjs');
let decisionMtime = statSync(decisionPath).mtimeMs;
let roles = null;
let rolesMtime = 0;
async function fresh() {
  const dm = statSync(decisionPath).mtimeMs;
  if (dm !== decisionMtime) { decisionMtime = dm; decision = await import(`${decisionPath}?t=${dm}`); }
  const rm = statSync(rolesPath).mtimeMs;
  if (rm !== rolesMtime) { rolesMtime = rm; roles = JSON.parse(readFileSync(rolesPath, 'utf8')); }
  return { interpret: decision.interpret, screening: decision.screening, roles };
}
// 组装角色问题:common.preamble 注入到各角色指令前;preamble:"own" 的角色自带完整开场白。
function buildQuestions(roles) {
  const common = roles.common?.preamble ?? [];
  const preamble = (Array.isArray(common) ? common : [common]).filter(Boolean).join('\n');
  const out = {};
  for (const [id, q] of Object.entries(roles.questions ?? {})) {
    const own = (Array.isArray(q.instructions) ? q.instructions : [q.instructions]).filter(Boolean).join('\n');
    out[id] = { ...q, instructions: (q.preamble === 'own' || !preamble ? '' : preamble + '\n') + own };
    delete out[id].preamble;
  }
  return out;
}
// 提交议案时附加的本地时间背景,供角色评估现实得失与安全风险。
const WEEK = ['周日','周一','周二','周三','周四','周五','周六'];
function timeContext() {
  const d = new Date();
  const h = d.getHours();
  const period = h < 5 ? '深夜' : h < 12 ? '上午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜';
  const pad = n => String(n).padStart(2, '0');
  return `系统补充(由终端实时提供,非用户文本):提交议案时的本地时间为 ${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${pad(h)}:${pad(d.getMinutes())}(${period})。评估现实得失与安全风险时可把它作为背景;它不改变表决对象本身。`;
}
function envFile(path) {
  try { return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1).trim().replace(/^(['"])(.*)\1$/, '$2')]; })); } catch { return {}; }
}
const cfg = { ...envFile(join(root, '.env.local')), ...process.env };
const key = cfg.TYPESAFE_API_KEY || envFile(cfg.TYPESAFE_KEY_FILE || '').TYPESAFE_API_KEY;
const port = Number(cfg.PORT || 4317);
const publicDailyLimit = Math.max(0, Math.floor(Number(cfg.PUBLIC_DAILY_LIMIT) || 0));
const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/sound.js',['sound.js','text/javascript; charset=utf-8']],
  ['/icon.svg',['icon.svg','image/svg+xml']],
  ['/eva-ming-sc-subset-v2.woff2',['eva-ming-sc-subset-v2.woff2','font/woff2']],
]);
const requests = new Map();
const publicUsage = new Map();
let concurrent = 0;
function validHistorySession(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value); }
function historyLine(value) { return value.replace(/[\t\r\n]+/g, ' ').trim(); }
async function recordQuestion(session, question) {
  if (!validHistorySession(session)) return;
  try {
    await mkdir(dirname(historyPath), { recursive:true });
    await appendFile(historyPath, `${new Date().toISOString()}\t${session}\t${historyLine(question)}\n`, 'utf8');
    // 超过 512KB 时只保留最后 500 条,防止文件无限增长。
    if ((await stat(historyPath).catch(() => ({ size: 0 }))).size > 512 * 1024) {
      const rows = (await readFile(historyPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
      if (rows.length > 500) await writeFile(historyPath, `${rows.slice(-500).join('\n')}\n`, 'utf8');
    }
  } catch { /* History must never interrupt a decision request. */ }
}
async function historyFor(session) {
  try {
    const rows = (await readFile(historyPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
    return rows.reverse().flatMap(row => {
      const [createdAt, owner, ...question] = row.split('\t');
      return owner === session && question.length ? [{ createdAt, question:question.join('\t') }] : [];
    }).slice(0, 100);
  } catch { return []; }
}
function localDay() { const d=new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
function quotaFor(address) {
  if (!publicDailyLimit) return { limit:0, remaining:null };
  const record=publicUsage.get(address);
  const used=record?.day===localDay() ? record.used : 0;
  return { limit:publicDailyLimit, remaining:Math.max(0,publicDailyLimit-used) };
}
function consumePublicQuota(address) {
  const quota=quotaFor(address);
  if (!quota.limit) return { ...quota, allowed:true };
  if (!quota.remaining) return { ...quota, allowed:false };
  publicUsage.set(address,{day:localDay(),used:quota.limit-quota.remaining+1});
  return { limit:quota.limit, remaining:quota.remaining-1, allowed:true };
}
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send = (code,data) => { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
  let url;
  try { url=new URL(req.url,'http://localhost'); } catch { return send(400,{message:'请求无效。'}); }
  const pathname=url.pathname;
  const address=req.socket.remoteAddress||'unknown';
  if (req.method === 'GET' && pathname === '/api/health') { const quota=quotaFor(address); const { roles: hotRoles } = await fresh(); return send(200,{ configured:Boolean(key), version:hotRoles?.version || '0.2', publicDailyLimit:quota.limit, publicRemaining:quota.remaining }); }
  if (req.method === 'GET' && pathname === '/api/history') {
    const session=url.searchParams.get('session')||'';
    if (!validHistorySession(session)) return send(400,{message:'历史终端标识无效。'});
    return send(200,{entries:await historyFor(session)});
  }
  if (req.method === 'GET' && assets.has(pathname)) {
    const [file,type] = assets.get(pathname);
    if (type === 'font/woff2') res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    if (file === 'index.html') {
      const { roles: hotRoles } = await fresh();
      const terminalId = String(hotRoles?.terminalId || `v${hotRoles?.version || '0.2'}`).replace(/[^0-9A-Za-z_.-]/g, '').slice(0, 12);
      const html = readFileSync(join(root,'public',file),'utf8').replace('id="terminal-id"', `id="terminal-id" data-id="${terminalId}"`);
      res.writeHead(200,{'Content-Type':type});
      return res.end(html);
    }
    res.writeHead(200,{'Content-Type':type}); return res.end(readFileSync(join(root,'public',file)));
  }
  if (pathname !== '/api/decide') return send(404,{message:'未找到页面。'});
  if (req.method !== 'POST') return send(405,{message:'请求方式不支持。'});
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return send(403,{message:'请求来源不匹配。'}); } catch { return send(403,{message:'请求来源不匹配。'}); }
  }
  if (!req.headers['content-type']?.startsWith('application/json')) return send(415,{message:'请求格式不支持。'});
  const now=Date.now();
  for (const [ip, times] of requests) { const active=times.filter(t=>now-t<60000); if (!active.length) requests.delete(ip); else requests.set(ip,active); }
  const recent=requests.get(address)||[];
  if (recent.length>=12 || concurrent>=3) return send(429,{message:'终端繁忙，请稍后提交。'});
  let text='';
  try {
    for await (const chunk of req) { text+=chunk; if (Buffer.byteLength(text)>4096) return send(413,{message:'议案超出长度限制，请控制在 300 字以内。'}); }
    let parsed; try { parsed=JSON.parse(text); } catch { return send(400,{message:'请求格式有误，请重新提交。'}); }
    const question=typeof parsed.question==='string' ? parsed.question.trim() : '';
    const privateKey=typeof parsed.apiKey==='string' ? parsed.apiKey.trim() : '';
    const historySession=typeof parsed.historySession==='string' ? parsed.historySession : '';
    const isExample=parsed.isExample===true;
    if (!question || question.length>300) return send(400,{message:'请输入 1～300 字的议案。'});
    if (privateKey.length>512) return send(400,{message:'私人 Key 格式有误，请重新输入。'});
    const requestKey=privateKey||key;
    if (!requestKey) return send(503,{message:'公共终端尚未连接。请在右上角启用私人终端。'});
    const quota=privateKey?null:consumePublicQuota(address);
    if (quota?.limit && !quota.allowed) return send(429,{code:'public_limit_reached',publicDailyLimit:quota.limit,publicRemaining:0,message:'今日公共终端次数已用尽。请在右上角启用私人终端继续使用。'});
    if (!isExample) void recordQuestion(historySession, question);
    requests.set(address,[...recent,now]); concurrent++;
    try {
      const { roles: hotRoles, screening: hotScreening } = await fresh();
      const upstream=await fetch('https://api.typesafe.ai/v1/systemone',{
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${requestKey}`},
        body:JSON.stringify({model:hotRoles.model,state:`${question}\n${timeContext()}`,questions:{...buildQuestions(hotRoles),...hotScreening}}),
        signal:AbortSignal.timeout(20000), redirect:'error',
      });
      if (!upstream.ok) return send(upstream.status===429?429:(privateKey&&(upstream.status===401||upstream.status===403)?401:502),{message:upstream.status===429?'判断服务繁忙，请稍后重试。':privateKey&&(upstream.status===401||upstream.status===403)?'私人 Key 无效或已失效，请在右上角重新设置。':'暂时无法连接判断服务，请稍后重试。'});
      const { interpret } = await fresh();
      return send(200,{...interpret(await upstream.json()),publicDailyLimit:quota?.limit,publicRemaining:quota?.remaining});
    } finally { concurrent--; }
  } catch { if (!res.headersSent) return send(502,{message:'连接中断，决议未完成。请重新提交。'}); }
});
server.requestTimeout=30000;
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已被使用。已有终端可能正在运行：http://localhost:'+port:'终端启动失败：'+error.code);process.exit(1);});
server.listen(port,cfg.HOST||'0.0.0.0',()=>{
  console.log(`TRIAD 已启动：http://localhost:${port}`);
  for(const interfaces of Object.values(networkInterfaces())) for(const n of interfaces||[]) if(n.family==='IPv4'&&!n.internal) console.log(`同一 Wi-Fi 手机访问：http://${n.address}:${port}`);
  console.log(key?'Jev 密钥已配置。按 Ctrl+C 停止。':'请先配置 TYPESAFE_API_KEY 或 TYPESAFE_KEY_FILE。');
});
