import React, { useState } from 'react'
import { Typography } from 'antd'
import { DownOutlined, RightOutlined } from '@ant-design/icons'
import type { ProcessInsight } from '../types/aiAsk'

const { Text } = Typography

interface ProcessPanelProps {
  process: ProcessInsight
}

const ProcessPanel: React.FC<ProcessPanelProps> = ({ process }) => {
  const [expanded, setExpanded] = useState(false)

  // Normalize optional arrays so downstream code never hits optional chaining issues
  const mappingChain = process.mappingChain ?? []
  const contextChain = process.contextChain ?? []

  const hasContent = process.understoodMetrics.length > 0
    || process.understoodDimensions.length > 0
    || process.semanticGaps.length > 0
    || process.analysisStrategy
    || contextChain.length > 0
    || mappingChain.length > 0

  return (
    <div style={{ marginTop: 8 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: 'pointer', userSelect: 'none', fontSize: 12, color: '#8c8c8c',
          padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {expanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
        <span>🔍 AI 理解过程</span>
      </div>

      {expanded && (
        <div style={{
          padding: '10px 12px', background: '#f5f5f5', borderRadius: 8,
          marginTop: 4, fontSize: 12, lineHeight: 1.8,
        }}>
          {!hasContent && (
            <Text type="secondary" style={{ fontSize: 12 }}>暂无过程信息</Text>
          )}

          {hasContent && (
            <>
              {/* Understood items */}
              {process.understoodMetrics.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <Text style={{ color: '#52c41a', fontSize: 12 }}>✅ AI 确定理解到：</Text>
                  <div style={{ paddingLeft: 12, color: '#555' }}>
                    {process.understoodMetrics.length > 0 && <div>指标：{process.understoodMetrics.join('、')}</div>}
                    {process.understoodDimensions.length > 0 && <div>维度：{process.understoodDimensions.join('、')}</div>}
                    {process.understoodTimeRange && <div>时间：{process.understoodTimeRange}</div>}
                    {process.understoodFilters.length > 0 && <div>过滤：{process.understoodFilters.join('、')}</div>}
                  </div>
                </div>
              )}

              {/* Semantic gaps */}
              {process.semanticGaps.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <Text style={{ color: '#fa8c16', fontSize: 12 }}>⚠ AI 不确定：</Text>
                  {process.semanticGaps.map((gap, i) => (
                    <div key={i} style={{ paddingLeft: 12, color: '#8c6e00' }}>
                      "{gap.field}"{gap.candidates ? ` → 可能是 ${gap.candidates.join('、')}` : ''}
                      <span style={{
                        fontSize: 10, marginLeft: 6, padding: '0 4px', borderRadius: 3,
                        background: gap.severity === 'high' ? '#fff1f0' : '#fffbe6',
                        color: gap.severity === 'high' ? '#cf1322' : '#ad8b00',
                      }}>
                        {gap.severity === 'high' ? '重要' : gap.severity === 'medium' ? '中等' : '轻微'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Analysis strategy */}
              {process.analysisStrategy && (
                <div style={{ marginBottom: 6 }}>
                  <Text style={{ color: '#4E7BF5', fontSize: 12 }}>📋 分析策略：</Text>
                  <div style={{ paddingLeft: 12, color: '#555' }}>{process.analysisStrategy}</div>
                </div>
              )}

              {/* Context chain */}
              {contextChain.length > 0 && (
                <div>
                  <Text style={{ color: '#666', fontSize: 12 }}>🔗 对话链路：</Text>
                  <div style={{ paddingLeft: 12, color: '#555' }}>
                    {contextChain.join(' → ')}
                  </div>
                </div>
              )}

              {/* Phase 5J: mappingChain */}
              {mappingChain.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text style={{ color: '#4E7BF5', fontSize: 12 }}>📋 分析链路：</Text>
                  <div style={{
                    padding: '8px 12px', background: '#f0f5ff', borderRadius: 6,
                    marginTop: 4, border: '1px solid #d6e4ff',
                  }}>
                    {mappingChain.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, position: 'relative' }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: '50%', background: '#4E7BF5',
                          color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', flexShrink: 0, marginTop: 1,
                        }}>
                          {i + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#333', fontSize: 12, fontWeight: 500 }}>{item.label}</div>
                          {item.detail && (
                            <div style={{ color: '#666', fontSize: 11 }}>{item.detail}</div>
                          )}
                          {item.fields && item.fields.length > 0 && (
                            <div style={{ color: '#999', fontSize: 10, marginTop: 1 }}>
                              {item.fields.join(', ')}
                            </div>
                          )}
                        </div>
                        {i < mappingChain.length - 1 && (
                          <div style={{
                            position: 'absolute', left: 9, top: 22, bottom: -4,
                            width: 1, background: '#d6e4ff',
                          }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ProcessPanel
