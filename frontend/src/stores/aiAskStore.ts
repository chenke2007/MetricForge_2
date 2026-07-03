// frontend/src/stores/aiAskStore.ts
import { create } from 'zustand'
import type { AiAskResponse } from '../types/aiAsk'

interface AiAskStore {
  // 数据范围
  datasourceId: number | null
  datasourceName: string | null
  selectedTables: string[]

  // 当前轮次结果
  currentResponse: AiAskResponse | null
  isAnalyzing: boolean
  activeChartIndex: number

  // 历史轮次产物 (key: assistant message id)
  responseHistory: Record<number, AiAskResponse>

  // Actions
  setDatasource: (id: number | null, name: string | null) => void
  setSelectedTables: (tables: string[]) => void
  setCurrentResponse: (resp: AiAskResponse | null) => void
  setAnalyzing: (v: boolean) => void
  setActiveChart: (index: number) => void
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
  activeChartIndex: 0,
  responseHistory: {},

  setDatasource: (id, name) => set({ datasourceId: id, datasourceName: name }),
  setSelectedTables: (tables) => set({ selectedTables: tables }),
  setCurrentResponse: (resp) => set({ currentResponse: resp, activeChartIndex: 0 }),
  setAnalyzing: (v) => set({ isAnalyzing: v }),
  setActiveChart: (index) => set({ activeChartIndex: index }),
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
      activeChartIndex: 0,
    }),
}))
