import { describe, it, expect, beforeEach } from 'vitest'
import { useAiAskStore } from './aiAskStore'
import { MOCK_ASK_RESPONSE } from '../api/aiAsk.mock'

describe('aiAskStore', () => {
  beforeEach(() => {
    useAiAskStore.setState(useAiAskStore.getInitialState())
  })

  it('should set datasource', () => {
    useAiAskStore.getState().setDatasource(2, 'dwhrpt')
    const state = useAiAskStore.getState()
    expect(state.datasourceId).toBe(2)
    expect(state.datasourceName).toBe('dwhrpt')
  })

  it('should set current response and reset chart index', () => {
    useAiAskStore.getState().setCurrentResponse(MOCK_ASK_RESPONSE)
    const state = useAiAskStore.getState()
    expect(state.currentResponse?.question).toBe(MOCK_ASK_RESPONSE.question)
    expect(state.activeChartIndex).toBe(0)
  })

  it('should save and retrieve response history', () => {
    useAiAskStore.getState().saveResponseForMessage(1, MOCK_ASK_RESPONSE)
    const retrieved = useAiAskStore.getState().getResponseForMessage(1)
    expect(retrieved).toEqual(MOCK_ASK_RESPONSE)
    expect(useAiAskStore.getState().getResponseForMessage(999)).toBeUndefined()
  })

  it('should reset to initial state', () => {
    useAiAskStore.getState().setDatasource(2, 'dwhrpt')
    useAiAskStore.getState().setCurrentResponse(MOCK_ASK_RESPONSE)
    useAiAskStore.getState().reset()
    const state = useAiAskStore.getState()
    expect(state.datasourceId).toBeNull()
    expect(state.currentResponse).toBeNull()
  })
})
