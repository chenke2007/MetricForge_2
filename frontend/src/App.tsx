import { Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, Typography } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import MetadataJobsPage from './pages/MetadataJobsPage'
import LlmSettingsPage from './pages/LlmSettingsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Typography.Title level={3}>欢迎使用 MetricForge 智能数据工作台</Typography.Title>} />
            <Route path="/metadata/jobs" element={<MetadataJobsPage />} />
            <Route path="/llm-settings" element={<LlmSettingsPage />} />
            <Route path="/ask" element={<Typography.Text type="secondary">AI 问数工作台（开发中）</Typography.Text>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ConfigProvider>
    </QueryClientProvider>
  )
}

export default App
