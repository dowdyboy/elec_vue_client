<script setup lang="ts">
/**
 * SQLite 数据库演示页
 * 演示：CRUD / SQL 执行器 / 事务 / SQL 注入对比（node:sqlite 内置模块）
 */
import { h, onMounted, ref } from 'vue'
import {
  NCard,
  NButton,
  NInput,
  NDataTable,
  useMessage,
  useDialog,
  NText,
  NTag,
  NAlert,
  type DataTableColumns
} from 'naive-ui'
import FeatureLayout from '../components/FeatureLayout.vue'
import CodeBlock from '../components/CodeBlock.vue'
import sqliteCode from '../../../main/features/sqlite.ts?raw'

const message = useMessage()

// ── ① 笔记 CRUD ──
interface NoteRow {
  id: number
  title: string
  content: string
  created_at: string
}

const notes = ref<NoteRow[]>([])
const formTitle = ref('')
const formContent = ref('')
const editingId = ref<number | null>(null)

const columns: DataTableColumns<NoteRow> = [
  { title: 'ID', key: 'id', width: 60 },
  { title: '标题', key: 'title', width: 160 },
  { title: '内容', key: 'content', ellipsis: { tooltip: true } },
  { title: '创建时间', key: 'created_at', width: 160 },
  {
    title: '操作',
    key: 'action',
    width: 110,
    render: (row) =>
      h('div', { style: 'display:flex;gap:8px' }, [
        h('a', { style: 'cursor:pointer;color:#2f7ef7', onClick: () => startEdit(row) }, '编辑'),
        h('a', { style: 'cursor:pointer;color:#e5484d', onClick: () => remove(row.id) }, '删除')
      ])
  }
]

async function loadNotes(): Promise<void> {
  notes.value = (await window.api.db.list()) as NoteRow[]
}

async function save(): Promise<void> {
  if (!formTitle.value.trim()) {
    message.warning('标题不能为空')
    return
  }
  if (editingId.value === null) {
    await window.api.db.add({ title: formTitle.value, content: formContent.value })
    message.success('已新增笔记')
  } else {
    await window.api.db.update({
      id: editingId.value,
      title: formTitle.value,
      content: formContent.value
    })
    message.success('已更新笔记')
  }
  formTitle.value = ''
  formContent.value = ''
  editingId.value = null
  await loadNotes()
}

function startEdit(row: NoteRow): void {
  editingId.value = row.id
  formTitle.value = row.title
  formContent.value = row.content
}

function cancelEdit(): void {
  editingId.value = null
  formTitle.value = ''
  formContent.value = ''
}

async function remove(id: number): Promise<void> {
  await window.api.db.remove(id)
  message.info(`已删除 ID=${id}`)
  await loadNotes()
}

// ── ② SQL 执行器 ──
const sqlInput = ref('SELECT * FROM notes LIMIT 5')
const sqlResult = ref('')
const dialog = useDialog()

/** 真正执行并展示结果 */
async function executeSql(): Promise<void> {
  const res = await window.api.db.execute(sqlInput.value)
  if (!res.ok) {
    sqlResult.value = `❌ ${res.error}`
    return
  }
  sqlResult.value = res.rows
    ? JSON.stringify(res.rows, null, 2)
    : `✅ 已执行：影响 ${res.changes} 行（lastInsertRowid=${res.lastInsertRowid}）`
}

async function runSql(): Promise<void> {
  // 写操作（INSERT/UPDATE/DELETE）会修改数据：主进程标记 dangerous，页面二次确认
  const res = await window.api.db.execute(sqlInput.value)
  if (!res.ok) {
    sqlResult.value = `❌ ${res.error}`
    return
  }
  if (res.dangerous) {
    const keyword = sqlInput.value.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
    dialog.warning({
      title: '危险语句确认',
      content: `「${keyword}」将修改数据库数据（如 DELETE 无 WHERE 会清空表），确认执行？`,
      positiveText: '执行',
      negativeText: '取消',
      onPositiveClick: () => executeSql()
    })
    return
  }
  sqlResult.value = JSON.stringify(res.rows, null, 2)
}

// ── ③ 注入对比 ──
const keyword = ref('事务')
const safeResult = ref<NoteRow[]>([])
const unsafeResult = ref<NoteRow[]>([])

async function searchSafe(): Promise<void> {
  safeResult.value = (await window.api.db.search(keyword.value, true)) as NoteRow[]
  message.success(`参数化查询返回 ${safeResult.value.length} 条`)
}

/** 演示注入：输入 ' OR '1'='1 查看漏洞效果 */
async function searchUnsafe(): Promise<void> {
  unsafeResult.value = (await window.api.db.search(keyword.value, false)) as NoteRow[]
  message.warning(`字符串拼接查询返回 ${unsafeResult.value.length} 条（被注入了？）`)
}

// ── ④ 事务 ──
async function runTransaction(): Promise<void> {
  const res = await window.api.db.transaction()
  if (res.ok) {
    message.success(`事务提交成功，插入 ${res.inserted} 条记录`)
  } else {
    message.error(`事务已回滚: ${res.error}`)
  }
  await loadNotes()
}

// ── ⑤ 数据库信息 ──
const dbInfo = ref<{ dbPath: string; tables: string[]; total: number } | null>(null)

onMounted(async () => {
  await loadNotes()
  dbInfo.value = await window.api.db.info()
})
</script>

<template>
  <FeatureLayout
    title="SQLite 数据库"
    api="node:sqlite（Node 内置，零依赖）"
    intro="Electron 39 内置 Node 22.20，自带 node:sqlite 模块（DatabaseSync）——与生产标准库 better-sqlite3 同底层 SQLite，同步 API、无需编译。数据文件存放在 userData/app.db。本页演示完整 CRUD、SQL 执行器、事务原子性，以及最关键的：参数化查询防 SQL 注入。注意：node:sqlite 是实验性 API（启动的 ExperimentalWarning 属预期，含义见 docs/25）；第三方库对比见「第三方 SQLite」页。"
  >
    <n-alert type="info" :show-icon="true" size="small" style="margin-bottom: 12px">
      想了解内置库与 better-sqlite3 的取舍？左菜单「第三方 SQLite」页提供同口径对比
      （API/构建链路/性能基准），选择依据见 docs/34。
    </n-alert>
    <n-card size="small" title="① 笔记 CRUD（参数化查询）" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap">
        <n-input v-model:value="formTitle" placeholder="标题" style="width: 200px" />
        <n-input v-model:value="formContent" placeholder="内容" style="flex: 1; min-width: 200px" />
        <n-button type="primary" @click="save">{{
          editingId === null ? '新增' : '保存修改'
        }}</n-button>
        <n-button v-if="editingId !== null" @click="cancelEdit">取消</n-button>
      </div>
      <n-data-table
        :columns="columns"
        :data="notes"
        size="small"
        :bordered="false"
        max-height="240"
      />
      <n-tag size="small" type="info" round style="margin-top: 8px"
        >共 {{ notes.length }} 条记录</n-tag
      >
    </n-card>

    <n-card size="small" title="② SQL 执行器（实验区）" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px">
        <n-input
          v-model:value="sqlInput"
          placeholder="输入 SQL（仅 SELECT/INSERT/UPDATE/DELETE）"
        />
        <n-button type="primary" @click="runSql">执行</n-button>
      </div>
      <n-text
        style="
          display: block;
          margin-top: 8px;
          font-size: 12px;
          white-space: pre-wrap;
          max-height: 200px;
          overflow-y: auto;
        "
        >{{ sqlResult }}</n-text
      >
    </n-card>

    <n-card size="small" title="③ SQL 注入对比（教学重点）" style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <n-input v-model:value="keyword" placeholder="搜索关键词" style="width: 200px" />
        <n-button type="success" @click="searchSafe">参数化查询（安全）</n-button>
        <n-button type="error" @click="searchUnsafe">字符串拼接（漏洞）</n-button>
      </div>
      <n-alert type="warning" :show-icon="true" size="small" style="margin-top: 8px">
        把搜索词改为 <code>' OR '1'='1</code> 再分别点击两个按钮： 安全版返回 0
        条，漏洞版返回【全部】记录 —— 这就是 SQL 注入如何绕过条件。
      </n-alert>
      <div style="display: flex; gap: 16px; margin-top: 8px; font-size: 12px">
        <div>
          <b>安全版结果: </b>{{ safeResult.length }} 条
          <span v-if="safeResult.length">（{{ safeResult.map((r) => r.title).join('、') }}）</span>
        </div>
        <div>
          <b>漏洞版结果: </b>{{ unsafeResult.length }} 条
          <span v-if="unsafeResult.length"
            >（{{ unsafeResult.map((r) => r.title).join('、') }}）</span
          >
        </div>
      </div>
    </n-card>

    <n-card size="small" title="④ 事务与数据库信息" style="margin-bottom: 12px">
      <n-button type="warning" @click="runTransaction">事务批量插入 3 条</n-button>
      <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
        事务保证原子性：要么全部插入成功（COMMIT），要么一条不留（ROLLBACK）。
      </n-text>
      <n-tag v-if="dbInfo" size="small" type="info" round style="display: block; margin-top: 8px">
        数据文件: {{ dbInfo.dbPath }}（表: {{ dbInfo.tables.join(', ') }}，共
        {{ dbInfo.total }} 条）
      </n-tag>
    </n-card>

    <template #code>
      <CodeBlock file="src/main/features/sqlite.ts" :code="sqliteCode" />
    </template>
  </FeatureLayout>
</template>
