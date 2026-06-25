import { create } from 'zustand'

export interface StreamingState {
  visible: boolean
  messageId: number
  content: string
}

interface AskStore {
  currentSessionId: number | null
  streaming: StreamingState | null

  setCurrentSession: (id: number | null) => void
  startStream: (messageId: number) => void
  appendToken: (delta: string) => void
  stopStream: () => void
}

export const useAskStore = create<AskStore>((set) => ({
  currentSessionId: null,
  streaming: null,

  setCurrentSession: (id) => set({ currentSessionId: id }),

  startStream: (messageId) =>
    set({
      streaming: {
        visible: true,
        messageId,
        content: '',
      },
    }),

  appendToken: (delta) =>
    set((state) => {
      if (!state.streaming) return state
      return {
        streaming: {
          ...state.streaming,
          content: state.streaming.content + delta,
        },
      }
    }),

  stopStream: () =>
    set((state) => {
      if (!state.streaming) return state
      return { streaming: null }
    }),
}))
