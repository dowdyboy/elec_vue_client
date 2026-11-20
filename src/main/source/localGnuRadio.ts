/**
 * 本机 GNU Radio 一键启动（不绑死具体环境）
 *
 * - Python 路径 / 脚本目录 / 脚本名 / 端口 / 采样率 都可配置，并持久化到
 *   userData/local-gnuradio.json；
 * - 默认值只做“候选探测”（环境变量 + 常见 radioconda/miniconda 路径），
 *   找不到时留空，由用户在页面里填；
 * - 启动的是任意兼容协议的本机脚本（默认 tools/gnuradio/tone_pipeline.py），
 *   脚本 stdout 输出 `READY {"port":...}` 后返回；
 * - 退出/断开时杀进程树，避免残留 Python。
 */
import { app, ipcMain } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LocalGnuRadioSettings, LocalGnuRadioStatus } from '../../shared/localGnuRadio'
import type { NetworkFormat } from '../../shared/sourceNetwork'
import { FORBIDDEN, isTrustedSender } from '../utils/validateSender'

const SETTINGS_FILE = 'local-gnuradio.json'
const MAX_LOG = 200

export function scriptDirDefault(): string {
  const dev = join(process.cwd(), 'tools', 'gnuradio')
  const bundled = join(process.resourcesPath, 'gnuradio')
  return app.isPackaged ? bundled : dev
}

/** 候选 Python 路径：环境变量优先，其次扫描常见 radioconda/miniconda 环境目录 */
export function detectPython(): string {
  const fromEnv = [
    process.env['GNU_RADIO_PYTHON'],
    process.env['RADIOCONDA_PYTHON'],
    process.env['CONDA_PYTHON_EXE']
  ].filter((p): p is string => !!p && existsSync(p))
  if (fromEnv[0]) return fromEnv[0]

  const home = homedir()
  const envRoots = [
    join(home, 'miniconda3', 'envs'),
    join(home, 'anaconda3', 'envs'),
    join(home, 'radioconda'),
    'C:\\ProgramData\\miniconda3\\envs',
    'D:\\ProgramData\\miniconda3\\envs',
    'D:\\ProgramFiles\\miniconda3\\envs',
    'C:\\ProgramFiles\\miniconda3\\envs',
    'D:\\radioconda',
    'C:\\radioconda'
  ]
  // 1) 先按常见目录结构扫描 radioconda/gnuradio 环境
  for (const root of envRoots) {
    try {
      if (!existsSync(root)) continue
      const entries = readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!/gnuradio|radioconda/i.test(entry.name)) continue
        const python = join(root, entry.name, 'python.exe')
        if (existsSync(python)) return python
      }
    } catch {
      // 无权读取/目录消失：继续
    }
  }
  // 2) 兜底固定路径
  const candidates = [
    join(home, 'radioconda', 'python.exe'),
    join(home, 'miniconda3', 'envs', 'radioconda', 'python.exe'),
    join(home, 'anaconda3', 'envs', 'radioconda', 'python.exe'),
    'C:\\radioconda\\python.exe',
    'C:\\ProgramData\\miniconda3\\envs\\radioconda\\python.exe',
    'D:\\radioconda\\python.exe',
    'D:\\ProgramData\\miniconda3\\envs\\radioconda\\python.exe',
    'D:\\ProgramFiles\\miniconda3\\envs\\radioconda\\python.exe',
    join(process.env['CONDA_PREFIX'] ?? '', 'python.exe')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? ''
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

export function defaultLocalSettings(): LocalGnuRadioSettings {
  return {
    pythonPath: detectPython(),
    scriptDir: scriptDirDefault(),
    scriptName: 'tone_pipeline.py',
    sampleRate: 100_000,
    centerHz: 0,
    format: 'ci16',
    toneFreq: 10_000,
    dualStream: false,
    displaySampleRate: 100_000,
    channels: 1,
    tcpPort: 0,
    recordPort: 0
  }
}

/** 校验并补齐设置（纯函数，便于单测） */
export function sanitizeLocalSettings(raw: unknown): LocalGnuRadioSettings {
  const base = defaultLocalSettings()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const src = raw as Record<string, unknown>
  const str = (k: string, fallback: string): string =>
    typeof src[k] === 'string' ? (src[k] as string).trim() : fallback
  const num = (k: string, fallback: number, min: number, max: number): number => {
    const v = typeof src[k] === 'number' ? (src[k] as number) : NaN
    return Number.isFinite(v) ? Math.max(min, Math.min(max, Math.trunc(v))) : fallback
  }

  const pythonPath = str('pythonPath', base.pythonPath)
  const scriptDir = str('scriptDir', base.scriptDir)
  const scriptName = str('scriptName', base.scriptName) || base.scriptName
  const sampleRate = num('sampleRate', base.sampleRate, 1_000, 200_000_000)
  const centerHz = num('centerHz', base.centerHz, -1_000_000_000_000, 1_000_000_000_000)
  const toneFreq = num('toneFreq', base.toneFreq, 0, Math.max(1, sampleRate / 2))
  const dualStream = src.dualStream === true
  const displaySampleRate = num('displaySampleRate', base.displaySampleRate, 1000, sampleRate)
  const channels: 1 | 2 = src.channels === 2 ? 2 : 1
  const tcpPort = num('tcpPort', base.tcpPort, 0, 65_535)
  const recordPortRaw = num('recordPort', base.recordPort, 0, 65_535)
  // 与显示端口相同则视为未启用独立端口（避免启动即冲突）
  const recordPort = recordPortRaw > 0 && recordPortRaw === tcpPort ? 0 : recordPortRaw
  const format: NetworkFormat =
    src.format === 'cf32' || src.format === 'ci16' || src.format === 'ci8'
      ? src.format
      : base.format

  return {
    pythonPath,
    scriptDir,
    scriptName,
    sampleRate,
    centerHz,
    format,
    toneFreq,
    dualStream,
    displaySampleRate,
    channels,
    tcpPort,
    recordPort
  }
}

export function loadLocalSettings(): LocalGnuRadioSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    return sanitizeLocalSettings(JSON.parse(raw))
  } catch {
    return defaultLocalSettings()
  }
}

export function saveLocalSettings(patch: unknown): LocalGnuRadioSettings {
  const next = sanitizeLocalSettings({
    ...loadLocalSettings(),
    ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {})
  })
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch {
    // 写入失败不影响本次启动
  }
  return next
}

export class LocalGnuRadioRunner {
  private child: ChildProcess | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private status: LocalGnuRadioStatus = {
    running: false,
    pid: 0,
    port: 0,
    format: 'ci16',
    sampleRate: 0,
    dual: false,
    displaySampleRate: 0,
    recordPort: 0,
    channels: 1,
    startedAt: 0,
    lastError: '',
    log: []
  }
  getStatus(): LocalGnuRadioStatus {
    return { ...this.status, log: this.status.log.slice() }
  }

  async start(
    raw: unknown
  ): Promise<{ ok: boolean; error?: string; status?: LocalGnuRadioStatus }> {
    const cfg = sanitizeLocalSettings(raw)
    const scriptPath = join(cfg.scriptDir, cfg.scriptName)
    if (!cfg.pythonPath) return { ok: false, error: '未配置 Python 路径' }
    if (!existsSync(cfg.pythonPath)) return { ok: false, error: `Python 不存在: ${cfg.pythonPath}` }
    if (!existsSync(scriptPath)) return { ok: false, error: `脚本不存在: ${scriptPath}` }
    if (!cfg.scriptName.toLowerCase().endsWith('.py')) return { ok: false, error: '脚本必须是 .py' }

    await this.stop()
    this.status = {
      running: false,
      pid: 0,
      port: 0,
      format: cfg.format,
      sampleRate: cfg.sampleRate,
      dual: false,
      displaySampleRate: cfg.displaySampleRate,
      recordPort: 0,
      channels: cfg.channels,
      startedAt: Date.now(),
      lastError: '',
      log: []
    }

    return new Promise((resolve) => {
      let settled = false
      const finish = (ok: boolean, error?: string): void => {
        if (settled) return
        settled = true
        if (this.readyTimer) {
          clearTimeout(this.readyTimer)
          this.readyTimer = null
        }
        if (ok) resolve({ ok: true, status: this.getStatus() })
        else resolve({ ok: false, error, status: this.getStatus() })
      }

      const args = [
        '-u',
        scriptPath,
        '--tcp-port',
        String(cfg.tcpPort),
        '--format',
        cfg.format,
        '--sample-rate',
        String(cfg.sampleRate),
        '--freq',
        String(cfg.toneFreq),
        '--center-hz',
        String(cfg.centerHz)
      ]
      if (cfg.channels === 2) args.push('--channels', '2')
      if (cfg.dualStream) {
        args.push('--dual', '--display-sample-rate', String(cfg.displaySampleRate))
      }
      if (cfg.recordPort > 0) {
        args.push('--record-port', String(cfg.recordPort))
      }
      let child: ChildProcess
      try {
        child = spawn(cfg.pythonPath, args, {
          cwd: cfg.scriptDir,
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8'
          }
        })
      } catch (e) {
        finish(false, e instanceof Error ? e.message : String(e))
        return
      }
      this.child = child
      this.status.pid = child.pid ?? 0
      this.status.running = true

      const pushLine = (line: string): void => {
        const text = line.trim()
        if (!text) return
        this.status.log.push(text)
        if (this.status.log.length > MAX_LOG)
          this.status.log.splice(0, this.status.log.length - MAX_LOG)
        if (!settled && text.startsWith('READY ')) {
          try {
            const ready = JSON.parse(text.slice(6)) as {
              port?: number
              format?: NetworkFormat
              sampleRate?: number
              dual?: boolean
              displaySampleRate?: number
              recordPort?: number
              channels?: number
            }
            if (typeof ready.port === 'number' && ready.port > 0) {
              this.status.port = ready.port
              if (ready.format) this.status.format = ready.format
              if (typeof ready.sampleRate === 'number') this.status.sampleRate = ready.sampleRate
              if (typeof ready.dual === 'boolean') this.status.dual = ready.dual
              if (typeof ready.displaySampleRate === 'number')
                this.status.displaySampleRate = ready.displaySampleRate
              if (typeof ready.recordPort === 'number') this.status.recordPort = ready.recordPort
              if (ready.channels === 2) this.status.channels = 2
              finish(true)
              return
            }
          } catch {
            // 继续等下一行
          }
        }
      }

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) pushLine(line)
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) pushLine(line)
      })

      child.on('error', (err) => {
        this.status.lastError = err.message
        this.status.running = false
        finish(false, err.message)
      })

      child.on('exit', (code, signal) => {
        const wasRunning = this.status.running
        this.status.running = false
        this.status.pid = 0
        if (!settled) {
          this.status.lastError = `进程退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`
          this.child = null
          finish(false, this.status.lastError)
          return
        }
        if (wasRunning && code !== 0) {
          this.status.lastError = `进程异常退出（code=${code ?? 'null'}）`
        }
        this.child = null
      })

      this.readyTimer = setTimeout(() => {
        this.status.lastError = '等待 READY 超时（20s）'
        finish(false, this.status.lastError)
        void this.stop()
      }, 20_000)
    })
  }

  async stop(): Promise<void> {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
    const child = this.child
    this.child = null
    this.status.running = false
    this.status.pid = 0
    if (!child || !child.pid) return
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      try {
        child.kill()
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    void this.stop()
  }
}

export function registerLocalGnuRadio(): () => void {
  const runner = new LocalGnuRadioRunner()

  ipcMain.handle('source:localDefaults', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const settings = loadLocalSettings()
    const scriptPath = join(settings.scriptDir, settings.scriptName)
    return {
      settings,
      detectedPython: detectPython(),
      scriptDir: scriptDirDefault(),
      scriptPath,
      scriptExists: existsSync(scriptPath),
      pythonExists: !!settings.pythonPath && existsSync(settings.pythonPath)
    }
  })

  ipcMain.handle('source:localSaveSettings', (e, patch: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return saveLocalSettings(patch)
  })

  ipcMain.handle('source:localStart', async (e, cfg: unknown) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    const settings = saveLocalSettings(cfg)
    return runner.start(settings)
  })

  ipcMain.handle('source:localStop', async (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    await runner.stop()
    return { ok: true, status: runner.getStatus() }
  })

  ipcMain.handle('source:localStatus', (e) => {
    if (!isTrustedSender(e)) return FORBIDDEN
    return runner.getStatus()
  })

  return () => {
    runner.dispose()
    ipcMain.removeHandler('source:localDefaults')
    ipcMain.removeHandler('source:localSaveSettings')
    ipcMain.removeHandler('source:localStart')
    ipcMain.removeHandler('source:localStop')
    ipcMain.removeHandler('source:localStatus')
  }
}
