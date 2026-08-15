<script setup lang="ts">
/**
 * 第三方 SQLite 演示页（better-sqlite3）
 * 与内置 node:sqlite（SQLite 数据库页）对比教学：
 * CRUD / 注入对比 / transaction() 事务包装 / 两库同口径性能基准
 */
import { onMounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NInput,
  NInputNumber,
  NSpace,
  NAlert,
  NText,
  NTag,
  useMessage
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import betterSqliteCode from '../../../main/features/betterSqlite.ts?raw'

const message = useMessage()

// ── 对比概览表 ──
const compareRows = [
  { dim: '依赖', node: 'Node 22+ 内置（零依赖）', better: '第三方原生模块（npm 安装）' },
  {
    dim: 'API 稳定性',
    node: '实验性（启动打印 ExperimentalWarning，本项目保留）',
    better: '长期稳定（10+ 年维护史）'
  },
  {
    dim: '构建链路',
    node: '无（随 Electron 捆绑 Node）',
    better: '需按 Electron ABI 重编译（electron-rebuild）'
  },
  { dim: '打包', node: '无特殊处理', better: 'electron-builder 自动外置 .node 到 asar 外' },
  {
    dim: '特色功能',
    node: '核心 CRUD/事务',
    better: 'transaction() 包装、backup、自定义函数、查询计划'
  },
  {
    dim: '升级风险',
    node: '升级 Electron 时 API 可能变更（见 docs/25 检查清单）',
    better: '升级 Electron 仅需重编译'
  }
]

// ── CRUD 演示 ──
const notes = ref<{ id: number; title: string; content: string }[]>([])
const newTitle = ref('better-sqlite3 笔记')
const newContent = ref('来自第三方库的写入')
const searchKeyword = ref('')
const searchResult = ref<{ id: number; title: string; content: string }[]>([])
const dbInfo = ref('')

async function refreshList(): Promise<void> {
  notes.value = await window.api.betterDb.list()
}

async function addNote(): Promise<void> {
  if (!newTitle.value.trim()) {
    message.warning('请输入标题')
    return
  }
  await window.api.betterDb.add({ title: newTitle.value, content: newContent.value })
  message.success('已插入（better-sqlite3）')
  await refreshList()
}

async function removeNote(id: number): Promise<void> {
  await window.api.betterDb.remove(id)
  message.info('已删除')
  await refreshList()
}

/** 注入对比：safe=true 参数化（正确），safe=false 拼接（漏洞演示） */
async function doSearch(safe: boolean): Promise<void> {
  searchResult.value = await window.api.betterDb.search(searchKeyword.value, safe)
  message.info(safe ? '参数化查询（安全）' : '字符串拼接（存在注入漏洞，演示用）')
}

async function doTransaction(): Promise<void> {
  const res = await window.api.betterDb.transaction()
  if (res.ok) {
    message.success(`transaction() 批量插入 ${res.inserted} 条（异常自动 ROLLBACK）`)
    await refreshList()
  } else {
    message.error(res.error ?? '事务失败')
  }
}

// ── 性能基准（两库同口径对比）──
interface BenchmarkResult {
  engine: string
  rows: number
  insertMs: number
  queryMs: number
  total: number
}

const benchRows = ref(2000)
const benchResults = ref<BenchmarkResult[]>([])
const benching = ref(false)

async function runBenchmark(engine: 'node' | 'better'): Promise<void> {
  benching.value = true
  try {
    const res =
      engine === 'node'
        ? await window.api.db.benchmark(benchRows.value)
        : await window.api.betterDb.benchmark(benchRows.value)
    benchResults.value = benchResults.value.filter((r) => r.engine !== res.engine)
    benchResults.value.push(res)
  } catch (error) {
    message.error((error as Error).message)
  } finally {
    benching.value = false
  }
}

onMounted(async () => {
  await refreshList()
  dbInfo.value = JSON.stringify(await window.api.betterDb.info())
})
</script>

<template>
  <FeatureLayout
    title="第三方 SQLite（better-sqlite3）"
    api="better-sqlite3"
    intro="内置 node:sqlite 是实验性 API，而 Electron 生态里最成熟的第三方方案是 better-sqlite3：API 长期稳定、功能丰富，代价是原生模块的编译链路（Electron ABI ≠ Node ABI）。本页与「SQLite 数据库」页同口径对比：CRUD、注入防护、事务包装、性能基准。两者 prepare/run/get/all 风格几乎一致，迁移成本很低。"
  >
    <n-card size="small" title="① 两库对比概览" style="margin-bottom: 12px">
      <table class="cmp-table">
        <thead>
          <tr>
            <th>维度</th>
            <th>node:sqlite（内置）</th>
            <th>better-sqlite3（第三方）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in compareRows" :key="row.dim">
            <td>
              <b>{{ row.dim }}</b>
            </td>
            <td>{{ row.node }}</td>
            <td>{{ row.better }}</td>
          </tr>
        </tbody>
      </table>
    </n-card>

    <n-card size="small" title="② CRUD + 注入对比 + transaction() 事务" style="margin-bottom: 12px">
      <n-space style="margin-bottom: 8px">
        <n-input v-model:value="newTitle" placeholder="标题" style="width: 220px" />
        <n-input v-model:value="newContent" placeholder="内容" style="width: 260px" />
        <n-button type="primary" @click="addNote">插入笔记</n-button>
        <n-button @click="doTransaction">事务批量插入 3 条</n-button>
      </n-space>
      <n-space style="margin-bottom: 8px">
        <n-input
          v-model:value="searchKeyword"
          placeholder="搜索关键词（试试 ' OR '1'='1）"
          style="width: 260px"
        />
        <n-button @click="doSearch(true)">参数化搜索（安全）</n-button>
        <n-button type="warning" @click="doSearch(false)">拼接搜索（注入演示）</n-button>
      </n-space>
      <div v-if="notes.length" class="note-list">
        <div v-for="note in notes" :key="note.id" class="note-item">
          <n-text strong>{{ note.title }}</n-text>
          <n-text depth="3" style="margin-left: 8px; font-size: 12px">{{ note.content }}</n-text>
          <n-button size="tiny" style="margin-left: auto" @click="removeNote(note.id)"
            >删除</n-button
          >
        </div>
      </div>
      <div v-if="searchResult.length" style="margin-top: 8px">
        <n-tag type="info" size="small" style="margin-bottom: 4px"
          >搜索结果（{{ searchResult.length }} 条）</n-tag
        >
        <div v-for="r in searchResult" :key="r.id" class="note-item">
          <n-text>{{ r.title }}</n-text>
        </div>
      </div>
      <n-text v-if="dbInfo" depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        {{ dbInfo }}
      </n-text>
    </n-card>

    <n-card size="small" title="③ 性能基准（与 node:sqlite 同口径对比）">
      <n-space>
        <n-input-number
          v-model:value="benchRows"
          :min="100"
          :max="50000"
          :step="500"
          placeholder="行数"
          style="width: 140px"
        />
        <n-button type="primary" :loading="benching" @click="runBenchmark('node')">
          跑 node:sqlite 基准
        </n-button>
        <n-button type="primary" :loading="benching" @click="runBenchmark('better')">
          跑 better-sqlite3 基准
        </n-button>
      </n-space>
      <n-alert type="info" size="small" :show-icon="true" style="margin-top: 8px">
        两个基准均走"单事务批量插入 + 全表 COUNT"同口径；受机器负载影响，建议各跑 2~3 次看趋势。
        教学结论：同底层 SQLite，吞吐同一量级——选择依据是"API 稳定性 / 功能 /
        构建链路"，而非性能神话。
      </n-alert>
      <table v-if="benchResults.length" class="cmp-table" style="margin-top: 8px">
        <thead>
          <tr>
            <th>引擎</th>
            <th>行数</th>
            <th>插入耗时</th>
            <th>查询耗时</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in benchResults" :key="r.engine">
            <td>{{ r.engine }}</td>
            <td>{{ r.rows }}</td>
            <td>{{ r.insertMs.toFixed(1) }} ms</td>
            <td>{{ r.queryMs.toFixed(2) }} ms</td>
          </tr>
        </tbody>
      </table>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/betterSqlite.ts" :code="betterSqliteCode" />
    </template>
  </FeatureLayout>
</template>

<style scoped>
.cmp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.cmp-table th,
.cmp-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}
.cmp-table th {
  color: var(--text-color-2);
  font-weight: 600;
}
.note-list {
  margin-top: 8px;
}
.note-item {
  display: flex;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
  border-bottom: 1px dashed var(--border-color);
}
</style>
