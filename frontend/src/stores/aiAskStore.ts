// frontend/src/stores/aiAskStore.ts
import { create } from 'zustand'
import type { AiAskResponse } from '../types/aiAsk'
import type { ValidationResult } from '../api/aiAsk/validator'
import type { AiAskError } from '../api/aiAsk/errors'

interface AiAskStore {
  // 数据范围
  datasourceId: number | null
  datasourceName: string | null
  selectedTables: string[]

  // 当前轮次结果
  currentResponse: AiAskResponse | null
  isAnalyzing: boolean
  isExecuting: boolean
  activeChartIndex: number
  analysisStep: number          // 0=idle, 1=理解意图, 2=生成SQL, 3=执行查询, 4=生成图表, 5=生成解读

  // 5G.1 新增
  adapterName: string
  responseValidation: ValidationResult | null
  error: AiAskError | null

  // Phase 5L: Real LLM toggle
  useRealLlm: boolean

  // 历史轮次产物 (key: assistant message id)
  responseHistory: Record<number, AiAskResponse>

  // Actions
  setDatasource: (id: number | null, name: string | null) => void
  setSelectedTables: (tables: string[]) => void
  setCurrentResponse: (resp: AiAskResponse | null) => void
  setAnalyzing: (v: boolean) => void
  setExecuting: (v: boolean) => void
  setActiveChart: (index: number) => void
  setAnalysisStep: (step: number) => void
  setAdapterName: (name: string) => void
  setResponseValidation: (v: ValidationResult | null) => void
  setError: (error: AiAskError | null) => void
  clearError: () => void
  setUseRealLlm: (v: boolean) => void
  saveResponseForMessage: (messageId: number, resp: AiAskResponse) => void
  getResponseForMessage: (messageId: number) => AiAskResponse | undefined
  reset: () => void
}

export const useAiAskStore = create<AiAskStore>((set, get) => ({
  datasourceId: null,
  datasourceName: null,
  selectedTables: [],
  currentResponse: null,
  isAnalyzing: false,
  isExecuting: false,
  activeChartIndex: 0,
  analysisStep: 0,

  adapterName: 'MockAdapter',
  responseValidation: null,
  error: null,

  useRealLlm: false,

  responseHistory: {},

  setDatasource: (id, name) => set({ datasourceId: id, datasourceName: name }),
  setSelectedTables: (tables) => set({ selectedTables: tables }),
  setCurrentResponse: (resp) => set({ currentResponse: resp, activeChartIndex: 0 }),
  setAnalyzing: (v) => set({ isAnalyzing: v, analysisStep: v ? 1 : 0 }),
  setExecuting: (v) => set({ isExecuting: v }),
  setActiveChart: (index) => set({ activeChartIndex: index }),
  setAnalysisStep: (step) => set({ analysisStep: step }),
  setAdapterName: (name) => set({ adapterName: name }),
  setResponseValidation: (v) => set({ responseValidation: v }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setUseRealLlm: (v) => set({ useRealLlm: v }),
  saveResponseForMessage: (messageId, resp) =>
    set((state) => ({
      responseHistory: { ...state.responseHistory, [messageId]: resp },
    })),
  getResponseForMessage: (messageId) => get().responseHistory[messageId],
  reset: () =>
    set({
      datasourceId: null,
      datasourceName: null,
      selectedTables: [],
      currentResponse: null,
      isAnalyzing: false,
      isExecuting: false,
      activeChartIndex: 0,
      analysisStep: 0,
      adapterName: 'MockAdapter',
      responseValidation: null,
      error: null,
      useRealLlm: false,
    }),
}))
