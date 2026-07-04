import React from 'react'
import { Alert, Button, Space } from 'antd'
import type { SemanticGap } from '../types/aiAsk'

interface SemanticGapAlertProps {
  gaps: SemanticGap[]
  onNavigateToGovernance?: () => void
}

const SemanticGapAlert: React.FC<SemanticGapAlertProps> = ({ gaps, onNavigateToGovernance }) => {
  if (gaps.length === 0) return null

  const seriousGaps = gaps.filter((g) => g.reason === 'not_found')
  if (seriousGaps.length === 0) return null

  return (
    <Alert
      type="warning"
      showIcon
      style={{ borderRadius: 8, marginBottom: 12 }}
      message={
        <div>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>以下字段无法确认，已影响分析精度</div>
          {seriousGaps.map((gap) => (
            <div key={gap.field} style={{ fontSize: 12, marginTop: 2 }}>
              • 字段 "{gap.field}" — 在当前数据范围中未找到匹配字段
              {gap.candidates && gap.candidates.length > 0 && (
                <span style={{ color: '#8c6e00' }}>
                  {' '}（候选：{gap.candidates.join('、')}）
                </span>
              )}
            </div>
          ))}
          {onNavigateToGovernance && (
            <Space style={{ marginTop: 6 }}>
              <Button size="small" onClick={onNavigateToGovernance}>
                前往治理待办完善语义
              </Button>
            </Space>
          )}
        </div>
      }
    />
  )
}

export default SemanticGapAlert
