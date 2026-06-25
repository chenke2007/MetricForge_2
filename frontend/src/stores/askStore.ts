import { create } from 'zustand'

export interface StreamingState {
  visible: boolean
  messageId: string
  content: string
}

interface AskStore {
  currentSessionId: string | null
  streaming: StreamingState | null

  setCurrentSession: (id: string | null) => void
  startStream: (messageId: string) => void
  appendToken: (delta: string) => void
  endStream: () => void
  failStream: () => void
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

  endStream: () =>
    set((state) => {
      if (!state.streaming) return state
      return {
        streaming: {
          ...state.streaming,
          visible: false,
        },
      }
    }),

  failStream: () =>
    set((state) => {
      if (!state.streaming) return state
      return {
        streaming: {
          ...state.streaming,
          visible: false,
        },
      }
    }),
}))
