import React, { useRef, useCallback } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

interface SqlEditorProps {
  onExecute: () => void
  onSave: () => void
}

const SqlEditor: React.FC<SqlEditorProps> = ({ onExecute, onSave }) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const sql = useSqlWorkbenchStore((s) => s.sql)
  const setSql = useSqlWorkbenchStore((s) => s.setSql)
  const isExecuting = useSqlWorkbenchStore((s) => s.isExecuting)

  const handleEditorMount: OnMount = useCallback((editorInstance) => {
    editorRef.current = editorInstance

    editorInstance.addAction({
      id: 'sql-execute',
      label: 'Execute SQL',
      keybindings: [2048 | 13], // Ctrl+Enter
      run: () => {
        onExecute()
      },
    })

    editorInstance.addAction({
      id: 'sql-save',
      label: 'Save Draft',
      keybindings: [2048 | 49], // Ctrl+S
      run: () => {
        onSave()
      },
    })
  }, [onExecute, onSave])

  return (
    <Editor
      height="200px"
      language="sql"
      theme="vs-dark"
      value={sql}
      onChange={(value) => setSql(value || '')}
      onMount={handleEditorMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        tabSize: 2,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        readOnly: isExecuting,
        renderWhitespace: 'selection',
      }}
    />
  )
}

export default SqlEditor
