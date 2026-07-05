import React from 'react'
import { Typography } from 'antd'

const { Text } = Typography

interface ContextChainProps {
  contextChain: string[]
  currentIndex: number
  maxRounds?: number
}

const ContextChain: React.FC<ContextChainProps> = ({ contextChain, currentIndex, maxRounds = 5 }) => {
  if (contextChain.length === 0) return null

  // Truncate if too many rounds
  let displayChain = contextChain
  let truncatedBefore = 0
  if (contextChain.length > maxRounds) {
    truncatedBefore = contextChain.length - maxRounds
    displayChain = contextChain.slice(-maxRounds)
  }

  return (
    <div style={{
      marginBottom: 12, padding: '8px 12px', background: '#fafafa',
      borderRadius: 8, border: '1px solid #f0f0f0',
    }}>
      {truncatedBefore > 0 && (
        <Text style={{ fontSize: 11, color: '#999', display: 'block', marginBottom: 4 }}>
          以及更早的 {truncatedBefore} 轮
        </Text>
      )}
      {displayChain.map((q, idx) => {
        const absoluteRound = truncatedBefore + idx + 1
        const isCurrent = (truncatedBefore + idx) === currentIndex
        return (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontWeight: isCurrent ? 600 : 'normal',
            color: isCurrent ? '#4E7BF5' : '#666',
            fontSize: isCurrent ? 13 : 12,
            padding: '2px 0',
          }}>
            {idx > 0 && !isCurrent && (
              <Text style={{ fontSize: 10, color: '#bbb', marginRight: 2 }}>↓</Text>
            )}
            {idx > 0 && isCurrent && (
              <Text style={{ fontSize: 10, color: '#4E7BF5', marginRight: 2 }}>↓</Text>
            )}
            <span>第{absoluteRound}轮：{q}</span>
            {isCurrent && (
              <span style={{
                fontSize: 10, background: '#4E7BF5', color: '#fff',
                padding: '1px 6px', borderRadius: 8, marginLeft: 4,
              }}>
                当前
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ContextChain
