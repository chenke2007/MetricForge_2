import React from 'react'
import { Typography } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'

const { Text } = Typography

const BUSINESS_PROMPTS = [
  {
    title: '本月各区域收入排名',
    desc: '查看当月各区域的营收表现和排名变化',
  },
  {
    title: '近 7 天核心指标趋势',
    desc: '销售额、订单量、客单价日环比变化',
  },
  {
    title: '上季度毛利率 Top 5 产品线',
    desc: '识别盈利能力最强的产品线及其同比',
  },
  {
    title: '逾期订单风险预警',
    desc: '查询超时未交付的订单明细及金额占比',
  },
  {
    title: '月度经营分析简报',
    desc: '收入、成本、利润、现金流核心数据一览',
  },
  {
    title: '客户分层与复购分析',
    desc: '按 RFM 模型查看高价值客户流失预警',
  },
]

interface PromptCardsProps {
  onSelect: (prompt: string) => void
  activeSession?: boolean
}

const PromptCards: React.FC<PromptCardsProps> = ({ onSelect, activeSession }) => {
  if (activeSession) return null

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 12,
        }}
      >
        <ThunderboltOutlined style={{ color: '#faad14', fontSize: 15 }} />
        <Text style={{ fontSize: 13, color: '#666', fontWeight: 500 }}>
          试试这样问
        </Text>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 10,
        }}
      >
        {BUSINESS_PROMPTS.map((item) => (
          <div
            key={item.title}
            onClick={() => onSelect(item.title)}
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid #e8e8e8',
              background: '#fff',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#4E7BF5'
              e.currentTarget.style.background = '#f0f5ff'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(78, 123, 245, 0.12)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e8e8e8'
              e.currentTarget.style.background = '#fff'
              e.currentTarget.style.boxShadow = 'none'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <Text strong style={{ fontSize: 13, color: '#262626', display: 'block', marginBottom: 4 }}>
              {item.title}
            </Text>
            <Text style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.5 }}>
              {item.desc}
            </Text>
          </div>
        ))}
      </div>
    </div>
  )
}

export default PromptCards
