import React from 'react'
import { Layout as AntLayout, Menu, Typography, theme } from 'antd'
import {
  DatabaseOutlined,
  DashboardOutlined,
  GithubOutlined,
  SettingOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'

const { Header, Sider, Content } = AntLayout

const menuItems = [
  {
    key: '/',
    icon: <DashboardOutlined />,
    label: '工作台首页',
  },
  {
    key: '/metadata/jobs',
    icon: <DatabaseOutlined />,
    label: '采集任务',
  },
  {
    key: '/llm-settings',
    icon: <SettingOutlined />,
    label: 'LLM 配置',
  },
  {
    key: '/ask',
    icon: <MessageOutlined />,
    label: 'AI 问数',
  },
]

const Layout: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { token } = theme.useToken()

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="60">
        <div
          style={{
            height: 48,
            margin: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          MetricForge
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <AntLayout>
        <Header
          style={{
            padding: '0 24px',
            background: token.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Typography.Title level={5} style={{ margin: 0 }}>
            智能数据工作台
          </Typography.Title>
          <a
            href="https://github.com/chenke2007/MetricForge_2"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubOutlined style={{ fontSize: 20, color: token.colorText }} />
          </a>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  )
}

export default Layout
