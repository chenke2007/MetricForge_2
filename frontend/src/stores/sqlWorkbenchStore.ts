import { create } from 'zustand'
import type { ChartType } from '../utils/chartData'

export interface ExecutionResult {
  columns: string[]
  rows: any[][]
  row_count: number
  truncated: boolean
  elapsed_ms: number
  error?: string | null
  history_id?: number | null
}

export interface ChartConfig {
  chartType: ChartType
  xColumn: string | null
  yColumn: string | null
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
  resultView: 'table' | 'chart'
  chartConfig: ChartConfig

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
  setResultView: (view: 'table' | 'chart') => void
  setChartConfig: (config: ChartConfig) => void
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
  resultView: 'table' as const,
  chartConfig: {
    chartType: 'bar' as const,
    xColumn: null,
    yColumn: null,
  },
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

  setResultView: (view) => set({ resultView: view }),

  setChartConfig: (config) => set({ chartConfig: config }),

  setBottomTab: (tab) => set({ bottomTab: tab }),

  reset: () => set(initialState),
}))
