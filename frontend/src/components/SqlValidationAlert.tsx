// frontend/src/components/SqlValidationAlert.tsx
import type React from 'react'
import type { SqlValidationDetail, SqlValidationError } from '../types/aiAsk'

/** map rule → 中文标题 */
function ruleTitle(rule: string): string {
  switch (rule) {
    case 'FIELD_NOT_FOUND':
      return '字段不存在'
    case 'TABLE_SCHEMA_MISSING':
      return '缺少 Schema 限定'
    case 'UNKNOWN_TABLE_REFERENCE':
      return '引用了未选表'
    case 'PARTITION_FILTER_MISSING':
      return '缺少 pt 分区过滤'
    case 'DDL_DML_NOT_ALLOWED':
      return '只允许 SELECT 查询'
    case 'CASE_MISMATCH':
      return '字段大小写不匹配'
    case 'PARSE_ERROR':
      return 'SQL 解析失败'
    case 'METADATA_MISSING':
      return '缺少元数据'
    default:
      return rule
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: '1px solid #ff4d4f',
    borderRadius: 8,
    padding: '16px 20px',
    backgroundColor: '#fff2f0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  headerIcon: {
    color: '#ff4d4f',
    fontSize: 18,
    fontWeight: 700,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#ff4d4f',
    margin: 0,
  },
  errorItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 0',
    borderBottom: '1px solid #ffccc7',
  },
  errorDot: {
    color: '#ff4d4f',
    fontSize: 14,
    marginTop: 2,
    flexShrink: 0,
  },
  errorContent: {
    flex: 1,
    minWidth: 0,
  },
  errorRule: {
    fontSize: 13,
    fontWeight: 600,
    color: '#d4380d',
    marginBottom: 2,
  },
  errorMessage: {
    fontSize: 13,
    color: '#333',
    marginBottom: 2,
  },
  errorMeta: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  sqlBlock: {
    marginTop: 12,
    padding: '10px 12px',
    backgroundColor: '#fff',
    border: '1px solid #ffccc7',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "'SF Mono', 'Consolas', 'Monaco', monospace",
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    maxHeight: 200,
    overflowY: 'auto',
    color: '#333',
  },
  noErrors: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
}

interface SqlValidationAlertProps {
  /** SqlValidationDetail from backend response */
  detail: SqlValidationDetail
}

export const SqlValidationAlert: React.FC<SqlValidationAlertProps> = ({ detail }) => {
  const errorCount = detail.errors.length

  return (
    <div style={styles.container}>
      {/* 头部 */}
      <div style={styles.header}>
        <span style={styles.headerIcon}>!</span>
        <h3 style={styles.headerTitle}>
          SQL 校验未通过（{errorCount} 项）
        </h3>
      </div>

      {/* 错误列表 */}
      {detail.errors.length === 0 ? (
        <div style={styles.noErrors}>无具体错误信息</div>
      ) : (
        detail.errors.map((err: SqlValidationError, idx: number) => (
          <div key={idx} style={styles.errorItem}>
            <span style={styles.errorDot}>•</span>
            <div style={styles.errorContent}>
              <div style={styles.errorRule}>{ruleTitle(err.rule)}</div>
              <div style={styles.errorMessage}>{err.message}</div>
              {(err.field || err.table) && (
                <div style={styles.errorMeta}>
                  {err.field && <>字段：{err.field}</>}
                  {err.field && err.table && <> · </>}
                  {err.table && <>表：{err.table}</>}
                </div>
              )}
            </div>
          </div>
        ))
      )}

      {/* SQL 文本 */}
      {detail.sql && (
        <div style={styles.sqlBlock}>{detail.sql}</div>
      )}
    </div>
  )
}

export default SqlValidationAlert
