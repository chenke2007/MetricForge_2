// frontend/src/stores/aiAskStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useAiAskStore } from './aiAskStore'

// Use a minimal inline mock — NOT from aiAsk.mock.ts (will be deleted)
const MOCK_RESPONSE = {
  question: 'test',
  intent: { metrics: [], dimensions: [], filters: [], timeRange: undefined },
  sqlPlan: { datasourceId: 0, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
  chartSuggestions: [],
  narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
  semanticGaps: [],
}

describe('aiAskStore', () => {
  beforeEach(() => {
    useAiAskStore.setState(useAiAskStore.getInitialState())
  })

  it('has new 5G fields with defaults', () => {
    const state = useAiAskStore.getState()
    expect(state.adapterName).toBe('MockAdapter')
    expect(state.analysisStep).toBe(0)
    expect(state.error).toBeNull()
    expect(state.responseValidation).toBeNull()
    expect(state.isExecuting).toBe(false)
  })

  it('setAnalysisStep updates step', () => {
    useAiAskStore.getState().setAnalysisStep(3)
    expect(useAiAskStore.getState().analysisStep).toBe(3)
  })

  it('setAdapterName updates name', () => {
    useAiAskStore.getState().setAdapterName('FutureLlm')
    expect(useAiAskStore.getState().adapterName).toBe('FutureLlm')
  })

  it('setError and clearError work', () => {
    const err = new Error('test') as any
    useAiAskStore.getState().setError(err)
    expect(useAiAskStore.getState().error).toBe(err)
    useAiAskStore.getState().clearError()
    expect(useAiAskStore.getState().error).toBeNull()
  })

  it('should set datasource', () => {
    useAiAskStore.getState().setDatasource(2, 'dwhrpt')
    expect(useAiAskStore.getState().datasourceId).toBe(2)
  })

  it('should set current response and reset chart index', () => {
    useAiAskStore.getState().setCurrentResponse(MOCK_RESPONSE as any)
    expect(useAiAskStore.getState().currentResponse?.question).toBe('test')
    expect(useAiAskStore.getState().activeChartIndex).toBe(0)
  })

  it('should save and retrieve response history', () => {
    useAiAskStore.getState().saveResponseForMessage(1, MOCK_RESPONSE as any)
    const retrieved = useAiAskStore.getState().getResponseForMessage(1)
    expect(retrieved).toEqual(MOCK_RESPONSE)
    expect(useAiAskStore.getState().getResponseForMessage(999)).toBeUndefined()
  })

  it('should reset to initial state', () => {
    useAiAskStore.getState().setDatasource(2, 'dwhrpt')
    useAiAskStore.getState().setCurrentResponse(MOCK_RESPONSE as any)
    useAiAskStore.getState().reset()
    const state = useAiAskStore.getState()
    expect(state.datasourceId).toBeNull()
    expect(state.currentResponse).toBeNull()
    expect(state.analysisStep).toBe(0)
  })
})
