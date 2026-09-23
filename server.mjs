import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
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
function envFile(path) {
  try { return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1).trim().replace(/^(['"])(.*)\1$/, '$2')]; })); } catch { return {}; }
}
const cfg = { ...envFile(join(root, '.env.local')), ...process.env };
const key = cfg.TYPESAFE_API_KEY || envFile(cfg.TYPESAFE_KEY_FILE || '').TYPESAFE_API_KEY;
const port = Number(cfg.PORT || 4317);
const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/sound.js',['sound.js','text/javascript; charset=utf-8']],
  ['/icon.svg',['icon.svg','image/svg+xml']],
  ['/eva-ming-sc-subset-v2.woff2',['eva-ming-sc-subset-v2.woff2','font/woff2']],
]);
const requests = new Map();
let concurrent = 0;
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send = (code,data) => { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
  let pathname;
  try { pathname=new URL(req.url,'http://localhost').pathname; } catch { return send(400,{message:'请求无效。'}); }
  if (req.method === 'GET' && pathname === '/api/health') return send(200,{ configured: Boolean(key), version:'0.2' });
  if (req.method === 'GET' && assets.has(pathname)) {
    const [file,type] = assets.get(pathname);
    if (type === 'font/woff2') res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    res.writeHead(200,{'Content-Type':type}); return res.end(readFileSync(join(root,'public',file)));
  }
  if (pathname !== '/api/decide') return send(404,{message:'未找到页面。'});
  if (req.method !== 'POST') return send(405,{message:'请求方式不支持。'});
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return send(403,{message:'请求来源不匹配。'}); } catch { return send(403,{message:'请求来源不匹配。'}); }
  }
  if (!req.headers['content-type']?.startsWith('application/json')) return send(415,{message:'请求格式不支持。'});
  if (!key) return send(503,{message:'终端尚未连接。请在本机配置 Jev 密钥。'});
  const address=req.socket.remoteAddress;
  const now=Date.now();
  for (const [ip, times] of requests) { const active=times.filter(t=>now-t<60000); if (!active.length) requests.delete(ip); else requests.set(ip,active); }
  const recent=requests.get(address)||[];
  if (recent.length>=12 || concurrent>=3) return send(429,{message:'议案较多，请稍等片刻再提交。'});
  let text='';
  try {
    for await (const chunk of req) { text+=chunk; if (Buffer.byteLength(text)>4096) return send(413,{message:'议案太长，请控制在 300 字以内。'}); }
    let parsed; try { parsed=JSON.parse(text); } catch { return send(400,{message:'请求格式有误，请重新提交。'}); }
    const question=typeof parsed.question==='string' ? parsed.question.trim() : '';
    if (!question || question.length>300) return send(400,{message:'请输入 1～300 字的议案。'});
    requests.set(address,[...recent,now]); concurrent++;
    try {
      const { roles: hotRoles, screening: hotScreening } = await fresh();
      const upstream=await fetch('https://api.typesafe.ai/v1/systemone',{
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
        body:JSON.stringify({model:hotRoles.model,state:question,questions:{...hotRoles.questions,...hotScreening}}),
        signal:AbortSignal.timeout(20000), redirect:'error',
      });
      if (!upstream.ok) return send(upstream.status===429?429:502,{message:upstream.status===429?'判断服务繁忙，请稍后重试。':'判断服务暂时无法连接，请稍后重试。'});
      const { interpret } = await fresh();
      return send(200,interpret(await upstream.json()));
    } finally { concurrent--; }
  } catch { if (!res.headersSent) return send(502,{message:'本次连接中断，未生成裁决。请重试。'}); }
});
server.requestTimeout=30000;
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已被使用。已有终端可能正在运行：http://localhost:'+port:'终端启动失败：'+error.code);process.exit(1);});
server.listen(port,cfg.HOST||'0.0.0.0',()=>{
  console.log(`TRIAD 已启动：http://localhost:${port}`);
  for(const interfaces of Object.values(networkInterfaces())) for(const n of interfaces||[]) if(n.family==='IPv4'&&!n.internal) console.log(`同一 Wi-Fi 手机访问：http://${n.address}:${port}`);
  console.log(key?'Jev 密钥已配置。按 Ctrl+C 停止。':'请先配置 TYPESAFE_API_KEY 或 TYPESAFE_KEY_FILE。');
});
