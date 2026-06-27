import { create } from 'zustand'

export interface ExecutionResult {
  columns: string[]
  rows: any[][]
  row_count: number
  truncated: boolean
  elapsed_ms: number
  error?: string | null
  history_id?: number | null
}

export interface WorkbenchState {
  // 数据源
  datasourceId: number | null
  datasourceName: string | null

  // 编辑器
  sql: string

  // 执行状态
  isExecuting: boolean
  result: ExecutionResult | null
  resultVisible: boolean

  // 底部面板
  bottomTab: 'history' | 'drafts'

  // Actions
  setDatasource: (id: number | null, name: string | null) => void
  setSql: (sql: string) => void
  appendSql: (text: string) => void
  setExecuting: (v: boolean) => void
  setResult: (r: ExecutionResult | null) => void
  showResult: () => void
  hideResult: () => void
  setBottomTab: (tab: 'history' | 'drafts') => void
  reset: () => void
}

const initialState = {
  datasourceId: null,
  datasourceName: null,
  sql: '',
  isExecuting: false,
  result: null,
  resultVisible: false,
  bottomTab: 'history' as const,
}

export const useSqlWorkbenchStore = create<WorkbenchState>((set) => ({
  ...initialState,

  setDatasource: (id, name) =>
    set({ datasourceId: id, datasourceName: name }),

  setSql: (sql) => set({ sql }),

  appendSql: (text) =>
    set((state) => ({ sql: state.sql + text })),

  setExecuting: (v) => set({ isExecuting: v }),

  setResult: (r) => set({ result: r }),

  showResult: () => set({ resultVisible: true }),

  hideResult: () => set({ resultVisible: false }),

  setBottomTab: (tab) => set({ bottomTab: tab }),

  reset: () => set(initialState),
}))
