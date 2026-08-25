/**
 * 远程信号分析 mock 后端（socket.io）
 * 模拟“真实后端已算好帧”的形态：主进程以 RemoteAnalysisSource 连接此服务
 *
 * 用法:
 *   node scripts/remote-signal-mock.mjs                 # 默认 127.0.0.1:8768
 *   node scripts/remote-signal-mock.mjs --port 8768 --host 127.0.0.1
 *   node scripts/remote-signal-mock.mjs --help
 *
 * 协议（与 src/main/signal/analysisServer.ts:8 保持一致）:
 *   server emit('signal:analysis', { type:0|1|2, seq, fftSize?, modType?, buffer: Float32Array二进制 })
 *   server on('signal:analysis:config', patch)  // 前端下发的 SignalAnalysisConfig 变更
 *   server on('signal:analysis:trigger', () => tickOnce())
 */
import http from 'node:http'
import { Server } from 'socket.io'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
用法: node scripts/remote-signal-mock.mjs [options]

Options:
  --host <host>   监听地址 (默认 127.0.0.1)
  --port <port>   监听端口 (默认 8768)
  --help          帮助
示例:
  node scripts/remote-signal-mock.mjs
  node scripts/remote-signal-mock.mjs --port 8768
`)
  process.exit(0)
}
function getArg(name, def) {
  const idx = args.indexOf(name)
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]
  return def
}
const host = getArg('--host', '127.0.0.1')
const port = Number(getArg('--port', '8768'))

// 简易 DSP（与 src/shared/signalDsp.ts 等价的 JS 版，零依赖）
function getWindow(type, n) {
  const w = new Float32Array(n)
  if (type === 'rect') { w.fill(1); return w }
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / (n - 1)
    if (type === 'hann') w[i] = 0.5 * (1 - Math.cos(a))
    else if (type === 'hamming') w[i] = 0.54 - 0.46 * Math.cos(a)
    else if (type === 'blackman') w[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a)
    else w[i] = 1
  }
  return w
}
function applyWindow(data, win) { for (let i = 0; i < Math.min(data.length, win.length); i++) data[i] *= win[i] }
function magnitudeSpectrum(input, imIn) {
  const n = input.length
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of two')
  const re = new Float32Array(n); const imm = new Float32Array(n)
  re.set(input); if (imIn && imIn.length === n) imm.set(imIn)
  let j = 0; for (let i = 1; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = imm[i]; imm[i] = imm[j]; imm[j] = ti } }
  for (let len = 2; len <= n; len <<= 1) { const ang = 2 * Math.PI / len; const wlenR = Math.cos(ang); const wlenI = -Math.sin(ang); for (let i = 0; i < n; i += len) { let wr = 1, wi = 0; for (let k = 0; k < len / 2; k++) { const uR = re[i + k], uI = imm[i + k]; const vR = re[i + k + len / 2] * wr - imm[i + k + len / 2] * wi; const vI = re[i + k + len / 2] * wi + imm[i + k + len / 2] * wr; re[i + k] = uR + vR; imm[i + k] = uI + vI; re[i + k + len / 2] = uR - vR; imm[i + k + len / 2] = uI - vI; const nxtR = wr * wlenR - wi * wlenI, nxtI = wr * wlenI + wi * wlenR; wr = nxtR; wi = nxtI } } }
  const out = new Float32Array(n / 2); for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], imm[i]) / n; return out
}
function toDB(mag, floor = -120) { const out = new Float32Array(mag.length); for (let i = 0; i < mag.length; i++) { const v = mag[i] <= 1e-12 ? floor : 20 * Math.log10(mag[i]); out[i] = Math.max(floor, v) } return out }
function gaussian() { const u = Math.random() || 1e-12, v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
function noiseScale(snrDb) { return Math.pow(10, -snrDb / 20) }
const QPSK_MAP = [[1,1],[-1,1],[-1,-1],[1,-1]]
const BPSK_MAP = [[1,0],[-1,0]]

function computeRow(slice, cfg) {
  const n = cfg.fftSize
  const re = new Float32Array(n), im = new Float32Array(n)
  const count = Math.min(n, Math.floor(slice.length/2))
  for (let k=0;k<count;k++){ re[k]=slice[2*k]; im[k]=slice[2*k+1] }
  const win = getWindow(cfg.window, n); applyWindow(re, win); applyWindow(im, win)
  let mag = magnitudeSpectrum(re, im); if (cfg.dbScale) mag = toDB(mag); return mag
}

class SpectrogramAccumulator {
  constructor(){ this.buf=new Float32Array(0); this.len=0; this.pos=0 }
  push(iq,cfg){
    if (this.buf.length < this.len+iq.length){ const next=Math.max(this.len+iq.length, this.buf.length?this.buf.length*2:8192); const nb=new Float32Array(next); nb.set(this.buf.subarray(0,this.len)); this.buf=nb }
    this.buf.set(iq,this.len); this.len+=iq.length
    const need=cfg.fftSize*2, step=Math.max(2,Math.floor(cfg.fftSize*(1-cfg.overlap))*2)
    const rows=[]; while(this.pos+need<=this.len){ rows.push(computeRow(this.buf.subarray(this.pos,this.pos+need),cfg)); this.pos+=step }
    if(this.pos>cfg.fftSize*4){ this.buf.copyWithin(0,this.pos,this.len); this.len-=this.pos; this.pos=0 }
    return rows
  }
  reset(){ this.len=0; this.pos=0 }
}

function defaultCfg(){
  return { freq:50,snr:20,modType:'sine',sampleRate:4096,pointsPerFrame:2048,samplesPerSymbol:16,enabled:true,fftSize:1024,window:'hann',dbScale:true,overlap:0.5 }
}

// 配置校验（与 src/shared/signal.ts sanitizeConfigPatch 行为一致的 JS 版）
function sanitizePatch(patch){
  if(!patch || typeof patch!=='object' || Array.isArray(patch)) return null
  const out={}
  const num=(k)=> (typeof patch[k]==='number' && Number.isFinite(patch[k]) ? patch[k] : null)
  const int=(k)=>{ const v=num(k); return v===null?null:Math.trunc(v) }
  const f=num('freq'); if(f!==null && f>0) out.freq=f
  const snr=num('snr'); if(snr!==null && snr>=0 && snr<=100) out.snr=snr
  if(['sine','BPSK','QPSK','16QAM'].includes(patch.modType)) out.modType=patch.modType
  const sr=int('sampleRate'); if(sr!==null && sr>=256 && sr<=4194304) out.sampleRate=sr
  const ppf=int('pointsPerFrame'); if(ppf!==null && ppf>=64 && ppf<=65536) out.pointsPerFrame=ppf
  const sps=int('samplesPerSymbol'); if(sps!==null && sps>=1 && sps<=1024) out.samplesPerSymbol=sps
  if(typeof patch.enabled==='boolean') out.enabled=patch.enabled
  const fft=int('fftSize'); if(fft!==null && fft>=64 && fft<=65536 && (fft&(fft-1))===0) out.fftSize=fft
  if(['rect','hann','hamming','blackman'].includes(patch.window)) out.window=patch.window
  if(typeof patch.dbScale==='boolean') out.dbScale=patch.dbScale
  const ov=num('overlap'); if(ov!==null && ov>=0 && ov<=0.9) out.overlap=ov
  return out
}

let cfg = defaultCfg()
let seq = 0
let phase = 0
const acc = new SpectrogramAccumulator()

function genFrame(){
  const n=cfg.pointsPerFrame, out=new Float32Array(n*2), scale=noiseScale(cfg.snr), step=(2*Math.PI*cfg.freq)/cfg.sampleRate
  if(cfg.modType==='sine'){
    for(let k=0;k<n;k++){ out[2*k]=Math.cos(phase)+gaussian()*scale; out[2*k+1]=Math.sin(phase)+gaussian()*scale; phase+=step; if(phase>Math.PI*2) phase-=Math.PI*2 }
    return out
  }
  const S=Math.max(1,cfg.samplesPerSymbol|0); let symI=0,symQ=0,ph=0
  for(let k=0;k<n;k++){
    if(k%S===0){
      if(cfg.modType==='BPSK'){ const b=Math.random()>0.5?1:0; [symI,symQ]=BPSK_MAP[b] }
      else if(cfg.modType==='QPSK'){ const b=Math.floor(Math.random()*4); [symI,symQ]=QPSK_MAP[b] }
      else if(cfg.modType==='16QAM'){ const lv=[-3,-1,1,3]; symI=lv[Math.floor(Math.random()*4)]/3; symQ=lv[Math.floor(Math.random()*4)]/3 }
    }
    const ci=Math.cos(ph), si=Math.sin(ph); ph+=step
    out[2*k]=symI*ci - symQ*si + gaussian()*scale*0.3
    out[2*k+1]=symI*si + symQ*ci + gaussian()*scale*0.3
  }
  return out
}

function tick(io, force=false){
  if(!cfg.enabled) return
  // 空闲跳过：无订阅客户端时不做生成/FFT 重计算（trigger 强制一帧不受限）
  if(!force && io.engine.clientsCount===0) return
  const iq=genFrame(), s=++seq
  // 关键：buffer 必须以二进制发送（socket.io 会识别 Buffer/Buffer-like 为 binary）
  io.emit('signal:analysis', { type:2, seq: s, buffer: Buffer.from(iq.buffer, iq.byteOffset, iq.byteLength), modType: cfg.modType })
  const need=cfg.fftSize*2, slice=iq.length>=need? iq.subarray(iq.length-need):iq
  const spec=computeRow(slice,cfg)
  io.emit('signal:analysis', { type:0, seq: s, fftSize: cfg.fftSize, buffer: Buffer.from(spec.buffer, spec.byteOffset, spec.byteLength), modType: cfg.modType })
  const rows=acc.push(iq,cfg)
  for(const row of rows){
    io.emit('signal:analysis', { type:1, seq: ++seq, fftSize: cfg.fftSize, buffer: Buffer.from(row.buffer, row.byteOffset, row.byteLength), modType: cfg.modType })
  }
}

const httpServer = http.createServer((_,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin','*')
  res.end(JSON.stringify({ ok:true, note:'remote signal mock', host, port, cfg }))
})
const io = new Server(httpServer, { cors:{ origin:'*'} })

io.on('connection', (sock)=>{
  console.log(`[remote-mock] client connected ${sock.id} from ${sock.handshake.address}`)
  // 初次把当前配置推给客户端（可选）
  // 监听客户端下发的配置
  sock.on('signal:analysis:config', (patch)=>{
    console.log('[remote-mock] recv config', patch)
    const clean = sanitizePatch(patch)
    if(!clean || Object.keys(clean).length===0){
      console.warn('[remote-mock] invalid config ignored')
      return
    }
    cfg = { ...cfg, ...clean }
    // fft/window/overlap 变更需重置时频累计
    acc.reset()
  })
  sock.on('signal:analysis:trigger', ()=>{
    console.log('[remote-mock] trigger once')
    tick(io, true)
  })
  sock.on('disconnect', (reason)=> console.log(`[remote-mock] disconnect ${sock.id} ${reason}`))
})

let timer=null
function startTick(){ if(timer) return; timer=setInterval(()=>tick(io), Math.max(16, Math.floor(1000/60))); console.log(`[remote-mock] tick 60fps started`) }
function stopTick(){ if(timer){ clearInterval(timer); timer=null } }

httpServer.listen(port, host, ()=>{
  console.log(`[remote-mock] listening http://${host}:${port} (socket.io)`)
  console.log(`[remote-mock] cfg`, cfg)
  console.log(`[remote-mock] 等待 Electron 以 remote 模式连接 (remoteUrl=http://${host}:${port})`)
  console.log(`[remote-mock] Electron 侧请在“信号分析服务配置”中选“远程后端”并填 http://${host}:${port} 后点“重启服务”`)
  startTick()
})

process.on('SIGINT', ()=>{ console.log('\n[remote-mock] shutting down'); stopTick(); io.close(); httpServer.close(()=>process.exit(0)) })
process.on('SIGTERM', ()=>{ stopTick(); io.close(); httpServer.close(()=>process.exit(0)) })
