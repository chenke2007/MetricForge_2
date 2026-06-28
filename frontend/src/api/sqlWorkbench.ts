import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

/* ─── Types ─── */

export interface DatasourceOption {
  id: number
  name: string
  ds_type: string
  dialect: string
}

export interface SchemaNode {
  schema_name: string
  tables: TableNode[]
}

export interface TableNode {
  id: number
  name: string
  comment: string | null
  column_count: number
}

export interface SchemaTree {
  datasource_id: number
  datasource_name: string
  schemas: SchemaNode[]
}

export interface ColumnDetail {
  id: number
  name: string
  type: string
  nullable: boolean
  comment: string | null
  is_primary_key: boolean
  is_foreign_key: boolean
}

export interface SearchResult {
  match_type: 'table' | 'column'
  schema_name: string
  table_name: string
  table_comment: string | null
  column_name: string | null
  table_id: number
}

export interface ExecuteInput {
  datasource_id: number
  sql: string
}

export interface ExecuteResult {
  columns: string[]
  rows: any[][]
  row_count: number
  truncated: boolean
  elapsed_ms: number
  error?: string | null
  history_id?: number | null
}

export interface SqlDraft {
  id: number
  title: string
  sql_text: string
  datasource_id: number | null
  dialect: string
  description: string | null
  tags: string | null
  is_template: boolean
  created_at: string
  updated_at: string
}

export interface CreateDraftInput {
  title?: string
  sql_text: string
  datasource_id?: number | null
  dialect?: string
  description?: string | null
  tags?: string | null
}

export interface UpdateDraftInput {
  title?: string
  sql_text?: string
  datasource_id?: number | null
  description?: string | null
  tags?: string | null
}

export interface ExecutionHistory {
  id: number
  sql_text: string
  sql_hash: string
  datasource_id: number | null
  datasource_name: string | null
  status: string
  elapsed_ms: number | null
  row_count: number | null
  truncated: boolean
  error_message: string | null
  created_at: string
}

/* ─── Fetchers ─── */

function fetchDatasources(): Promise<DatasourceOption[]> {
  return apiFetch('/sql/datasources')
}

function fetchSchemaTree(datasourceId: number): Promise<SchemaTree> {
  return apiFetch(`/sql/schema?datasource_id=${datasourceId}`)
}

function fetchTableColumns(tableId: number): Promise<ColumnDetail[]> {
  return apiFetch(`/sql/tables/${tableId}/columns`)
}

function searchSchema(datasourceId: number, q: string): Promise<SearchResult[]> {
  return apiFetch(`/sql/schema/search?datasource_id=${datasourceId}&q=${encodeURIComponent(q)}`)
}

function executeSql(input: ExecuteInput): Promise<ExecuteResult> {
  return apiFetch('/sql/execute', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

function fetchDrafts(): Promise<SqlDraft[]> {
  return apiFetch('/sql/drafts')
}

function createDraft(input: CreateDraftInput): Promise<SqlDraft> {
  return apiFetch('/sql/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

function updateDraft(id: number, input: UpdateDraftInput): Promise<SqlDraft> {
  return apiFetch(`/sql/drafts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

function deleteDraft(id: number): Promise<void> {
  return apiFetch(`/sql/drafts/${id}`, { method: 'DELETE' })
}

function fetchHistory(datasourceId?: number, limit = 50): Promise<ExecutionHistory[]> {
  const params = new URLSearchParams()
  if (datasourceId) params.set('datasource_id', String(datasourceId))
  params.set('limit', String(limit))
  return apiFetch(`/sql/history?${params}`)
}

/* ─── Hooks ─── */

export function useSqlDatasources() {
  return useQuery({
    queryKey: ['sql', 'datasources'],
    queryFn: fetchDatasources,
  })
}

export function useSchemaTree(datasourceId: number | null) {
  return useQuery({
    queryKey: ['sql', 'schema', datasourceId],
    queryFn: () => fetchSchemaTree(datasourceId!),
    enabled: !!datasourceId,
  })
}

export function useTableColumns(tableId: number | null) {
  return useQuery({
    queryKey: ['sql', 'columns', tableId],
    queryFn: () => fetchTableColumns(tableId!),
    enabled: !!tableId,
  })
}

export function useSearchSchema(datasourceId: number | null, q: string) {
  return useQuery({
    queryKey: ['sql', 'search', datasourceId, q],
    queryFn: () => searchSchema(datasourceId!, q),
    enabled: !!datasourceId && q.length > 0,
  })
}

export function useExecuteSql() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: executeSql,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sql', 'history'] })
    },
  })
}

export function useSqlDrafts() {
  return useQuery({
    queryKey: ['sql', 'drafts'],
    queryFn: fetchDrafts,
  })
}

export function useCreateDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createDraft,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sql', 'drafts'] })
    },
  })
}

export function useUpdateDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & UpdateDraftInput) => updateDraft(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sql', 'drafts'] })
    },
  })
}

export function useDeleteDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteDraft,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sql', 'drafts'] })
    },
  })
}

export function useSqlHistory(datasourceId?: number | null) {
  return useQuery({
    queryKey: ['sql', 'history', datasourceId],
    queryFn: () => fetchHistory(datasourceId ?? undefined),
  })
}
