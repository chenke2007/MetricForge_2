import React from 'react'
import { Card, Typography, Tag, Space } from 'antd'
import {
  BulbOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  BarChartOutlined,
  SearchOutlined,
} from '@ant-design/icons'

export interface AgentItem {
  key: string
  label: string
  description: string
  icon: React.ReactNode
  enabled: boolean
  badge?: string
}

const AGENTS: AgentItem[] = [
  {
    key: 'ask',
    label: 'AI 问数',
    description: '用自然语言提问，秒级返回数据洞察',
    icon: <BulbOutlined />,
    enabled: true,
    badge: '可用',
  },
  {
    key: 'insight',
    label: 'AI 解读',
    description: '自动解读图表数据，发现隐藏趋势',
    icon: <SearchOutlined />,
    enabled: false,
    badge: '规划中',
  },
  {
    key: 'report',
    label: 'AI 报告',
    description: '一句话生成格式化数据报告',
    icon: <FileTextOutlined />,
    enabled: false,
    badge: '规划中',
  },
  {
    key: 'build',
    label: 'AI 搭建',
    description: '用对话式交互搭建数据看板',
    icon: <FundProjectionScreenOutlined />,
    enabled: false,
    badge: '规划中',
  },
  {
    key: 'explore',
    label: 'AI 洞察',
    description: '全维度数据探索与根因分析',
    icon: <BarChartOutlined />,
    enabled: false,
    badge: '规划中',
  },
]

export { AGENTS }

interface AgentNavProps {
  activeKey: string
  onChange: (key: string) => void
}

const AgentNav: React.FC<AgentNavProps> = ({ activeKey, onChange }) => {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '16px 0',
        overflowX: 'auto',
      }}
    >
      {AGENTS.map((agent) => {
        const isActive = activeKey === agent.key
        return (
          <Card
            key={agent.key}
            hoverable
            size="small"
            onClick={() => agent.enabled && onChange(agent.key)}
            style={{
              minWidth: 180,
              flex: '0 0 auto',
              cursor: agent.enabled ? 'pointer' : 'not-allowed',
              opacity: agent.enabled ? 1 : 0.55,
              border: isActive ? '1.5px solid #1677ff' : '1px solid #f0f0f0',
              background: isActive ? '#f0f5ff' : '#fff',
              borderRadius: 10,
              transition: 'all 0.2s ease',
              userSelect: 'none',
            }}
          >
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Space size={6}>
                  <span
                    style={{
                      fontSize: 18,
                      color: isActive ? '#1677ff' : '#595959',
                    }}
                  >
                    {agent.icon}
                  </span>
                  <Typography.Text
                    strong
                    style={{
                      fontSize: 14,
                      color: isActive ? '#1677ff' : '#262626',
                    }}
                  >
                    {agent.label}
                  </Typography.Text>
                </Space>
                {agent.badge && (
                  <Tag
                    color={agent.enabled ? 'blue' : 'default'}
                    style={{
                      fontSize: 11,
                      lineHeight: '18px',
                      borderRadius: 4,
                      marginRight: 0,
                    }}
                  >
                    {agent.badge}
                  </Tag>
                )}
              </div>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, lineHeight: '16px' }}
              >
                {agent.description}
              </Typography.Text>
            </Space>
          </Card>
        )
      })}
    </div>
  )
}

export default AgentNav
