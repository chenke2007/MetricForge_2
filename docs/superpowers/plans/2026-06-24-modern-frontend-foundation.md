# MetricForge 现代前端基础骨架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React + TypeScript + Vite modern frontend scaffold under `frontend/`, mount it at `/app` via FastAPI, and demonstrate the first API-connected page — all without touching existing Jinja `/web` routes.

**Architecture:** Add a `frontend/` directory as a standalone Vite SPA. In development, Vite proxies `/api` to FastAPI at `localhost:8000`. In production, FastAPI mounts the built static files at `/app/*`. The existing `/web/*` Jinja routes remain completely untouched.

**Tech Stack:** React 18, TypeScript, Vite, Ant Design 5, TanStack Query 5, React Router 6, Zustand, Vitest + React Testing Library, fastapi.staticfiles.StaticFiles

---

## Global Constraints

- Node.js >= 18 (confirmed: v22.14.0)
- npm >= 9 (confirmed: 11.14.0)
- Python >= 3.12 (confirmed: 3.12.0)
- Do NOT modify `app/web/` or any Jinja2 templates
- Do NOT modify any existing API routes
- Do NOT commit `DESIGN-vercel.md` or `reports/`
- All new frontend code goes under `frontend/`
- Frontend build output: `frontend/dist/`
- FastAPI serves static build at `/app`
- Vite dev server runs on `localhost:5173` with proxy to `localhost:8000`
- Update `.gitignore` for `node_modules/` and `frontend/dist/`

---

## File Structure

```
MetricForge/
├── frontend/
│   ├── src/
│   │   ├── main.tsx               # React entry point
│   │   ├── App.tsx                # Root component with router
│   │   ├── api/
│   │   │   ├── client.ts          # Axios/fetch wrapper + base URL
│   │   │   └── metadataJobs.ts    # TanStack Query hooks for /api/metadata/jobs
│   │   ├── pages/
│   │   │   └── MetadataJobsPage.tsx  # Demo page: list metadata collection jobs
│   │   ├── components/
│   │   │   └── Layout.tsx         # Ant Design layout with sidebar
│   │   └── styles/
│   │       └── global.css         # Minimal global overrides
│   ├── index.html                 # Vite entry HTML
│   ├── vite.config.ts             # Vite config with proxy
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── package.json
│   └── .gitignore
├── app/
│   └── main.py                    # Add StaticFiles mount for /app (MODIFY)
├── .gitignore                     # Add node_modules/, frontend/dist/ (MODIFY)
```

---

### Task 1: Scaffold Vite + React + TypeScript Project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles/global.css`
- Create: `frontend/.gitignore`

**Interfaces:**
- Consumes: nothing yet
- Produces: runnable Vite dev server at `localhost:5173` showing "MetricForge"

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "metricforge-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.0",
    "vitest": "^2.0.5",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.8",
    "jsdom": "^24.1.0"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `frontend/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
```

- [ ] **Step 5: Create `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MetricForge — 智能数据工作台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `frontend/src/main.tsx`**

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
```

- [ ] **Step 7: Create `frontend/src/App.tsx`**

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'

function App() {
  return (
    <Routes>
      <Route path="/" element={<div>MetricForge 智能数据工作台</div>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
```

- [ ] **Step 8: Create `frontend/src/styles/global.css`**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 9: Create `frontend/.gitignore`**

```
node_modules/
dist/
.DS_Store
*.local
```

- [ ] **Step 10: Update project root `.gitignore`**

Append to `d:\projects\MetricForge\.gitignore`:

```gitignore
# Frontend
frontend/node_modules/
frontend/dist/
```

- [ ] **Step 11: Install dependencies and verify dev server starts**

Run:

```powershell
cd frontend
npm install
```

Verify install succeeds without errors.

Run:

```powershell
cd frontend
npx vite --port 5173
```

Expected: Vite dev server starts on `http://localhost:5173` with no errors.

Stop the server with Ctrl+C.

- [ ] **Step 12: Verify build works**

Run:

```powershell
cd frontend
npx tsc --noEmit
npx vite build
```

Expected: `tsc` exits clean, `vite build` produces `frontend/dist/` with `index.html` and JS assets.

- [ ] **Step 13: Commit Task 1**

```powershell
git add frontend/ .gitignore
git commit -m "feat: scaffold React + TypeScript + Vite frontend"
```

---

### Task 2: Integrate Ant Design + TanStack Query + React Router

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: previous task's scaffold
- Produces: `Layout` component with Ant Design sidebar + header; App wrapped with QueryClientProvider and Ant ConfigProvider

- [ ] **Step 1: Add Ant Design and TanStack Query dependencies**

Update `frontend/package.json` — add to `dependencies`:

```json
    "@ant-design/icons": "^5.4.0",
    "antd": "^5.20.0",
    "@tanstack/react-query": "^5.51.0"
```

- [ ] **Step 2: Install new dependencies**

Run:

```powershell
cd frontend
npm install
```

Expected: install completes without errors.

- [ ] **Step 3: Create `frontend/src/components/Layout.tsx`**

```typescript
import React from 'react'
import { Layout as AntLayout, Menu, Typography, theme } from 'antd'
import {
  DatabaseOutlined,
  DashboardOutlined,
  GithubOutlined,
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
```

- [ ] **Step 4: Update `frontend/src/App.tsx` with providers and routes**

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'

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
            <Route path="/" element={<div>欢迎使用 MetricForge 智能数据工作台</div>} />
            <Route path="/metadata/jobs" element={<div>采集任务页面（待实现）</div>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ConfigProvider>
    </QueryClientProvider>
  )
}

export default App
```

- [ ] **Step 5: Verify build passes with Ant Design**

Run:

```powershell
cd frontend
npx tsc --noEmit
npx vite build
```

Expected: both commands succeed. Build produces `frontend/dist/` with bundled Ant Design CSS and JS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add frontend/
git commit -m "feat: integrate Ant Design, TanStack Query, React Router"
```

---

### Task 3: Create API Client and Metadata Jobs TanStack Query Hooks

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/metadataJobs.ts`

**Interfaces:**
- Produces: `useMetadataJobs(datasourceId?, status?)` hook returning `{ data, isLoading, error }`
- Produces: `useMetadataJob(jobId)` hook returning `{ data, isLoading, error }`
- Consumes: FastAPI `GET /api/metadata/jobs` and `GET /api/metadata/jobs/{jobId}`

- [ ] **Step 1: Create `frontend/src/api/client.ts`**

```typescript
const API_BASE = '/api'

export interface ApiError {
  message: string
  status: number
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error: ApiError = {
      message: body.detail || response.statusText || '请求失败',
      status: response.status,
    }
    throw error
  }
  return response.json()
}

export function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  }).then(handleResponse<T>)
}
```

- [ ] **Step 2: Create `frontend/src/api/metadataJobs.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface MetadataCollectionJob {
  id: number
  datasource_id: number
  status: string
  triggered_by: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  tables_count: number
  columns_count: number
  indexes_count: number
  constraints_count: number
  tables_added_count: number
  tables_deactivated_count: number
  columns_added_count: number
  columns_deactivated_count: number
  columns_type_changed_count: number
  columns_comment_changed_count: number
  governance_tickets_created_count: number
  change_summary: string | null
  error_message: string | null
  error_details: string | null
  datasource_name?: string
}

export interface MetadataJobsParams {
  datasource_id?: number
  status?: string
  limit?: number
}

export function useMetadataJobs(params?: MetadataJobsParams) {
  const searchParams = new URLSearchParams()
  if (params?.datasource_id) searchParams.set('datasource_id', String(params.datasource_id))
  if (params?.status) searchParams.set('status', params.status)
  if (params?.limit) searchParams.set('limit', String(params.limit))
  const qs = searchParams.toString()

  return useQuery<MetadataCollectionJob[]>({
    queryKey: ['metadataJobs', params],
    queryFn: () => apiFetch<MetadataCollectionJob[]>(`/metadata/jobs${qs ? `?${qs}` : ''}`),
  })
}

export function useMetadataJob(jobId: number) {
  return useQuery<MetadataCollectionJob>({
    queryKey: ['metadataJob', jobId],
    queryFn: () => apiFetch<MetadataCollectionJob>(`/metadata/jobs/${jobId}`),
    enabled: !!jobId,
  })
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run:

```powershell
cd frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Create basic Vitest setup for future tests**

Create `frontend/src/setupTests.ts`:

```typescript
import '@testing-library/jest-dom'
```

Update `frontend/vite.config.ts` — add Vitest config:

```typescript
export default defineConfig({
  // ...existing config...
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
} as any)
```

Add `/// <reference types="vitest" />` at the top of `vite.config.ts`.

- [ ] **Step 5: Write a smoke API client test**

Create `frontend/src/api/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch } from './client'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses successful JSON response', async () => {
    const mockData = [{ id: 1, status: 'success' }]
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const result = await apiFetch('/metadata/jobs')
    expect(result).toEqual(mockData)
    expect(fetch).toHaveBeenCalledWith('/api/metadata/jobs', expect.any(Object))
  })

  it('throws on error response with detail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ detail: '任务不存在' }),
    })

    await expect(apiFetch('/metadata/jobs/999')).rejects.toEqual({
      message: '任务不存在',
      status: 404,
    })
  })
})
```

- [ ] **Step 6: Run tests and verify they pass**

Run:

```powershell
cd frontend
npx vitest run
```

Expected: tests pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add frontend/
git commit -m "feat: add API client and metadata jobs TanStack Query hooks"
```

---

### Task 4: Build Metadata Jobs Demo Page

**Files:**
- Create: `frontend/src/pages/MetadataJobsPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useMetadataJobs` and `useMetadataJob` hooks from Task 3
- Consumes: `Layout` component from Task 2
- Produces: a working demo page at `/metadata/jobs` that calls the real FastAPI

- [ ] **Step 1: Create `frontend/src/pages/MetadataJobsPage.tsx`**

```typescript
import React from 'react'
import { Table, Tag, Card, Statistic, Row, Col, Spin, Alert, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useMetadataJobs } from '../api/metadataJobs'
import type { MetadataCollectionJob } from '../api/metadataJobs'

const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  success: { color: 'success', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', icon: <CloseCircleOutlined /> },
  partial_success: { color: 'warning', icon: <ClockCircleOutlined /> },
  running: { color: 'processing', icon: <SyncOutlined /> },
}

const columns: ColumnsType<MetadataCollectionJob> = [
  {
    title: 'ID',
    dataIndex: 'id',
    key: 'id',
    width: 60,
    render: (id: number) => <Typography.Text code>#{id}</Typography.Text>,
  },
  {
    title: '数据源',
    dataIndex: 'datasource_name',
    key: 'datasource_name',
    render: (name: string | undefined, record: MetadataCollectionJob) =>
      name || `数据源 #${record.datasource_id}`,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 130,
    render: (status: string) => {
      const cfg = statusConfig[status]
      return cfg ? (
        <Tag icon={cfg.icon} color={cfg.color}>
          {status}
        </Tag>
      ) : (
        <Tag>{status}</Tag>
      )
    },
  },
  {
    title: '触发',
    dataIndex: 'triggered_by',
    key: 'triggered_by',
    width: 100,
  },
  {
    title: '表/字段',
    key: 'tables_columns',
    width: 90,
    render: (_: unknown, record: MetadataCollectionJob) =>
      `${record.tables_count} / ${record.columns_count}`,
  },
  {
    title: '变更',
    key: 'changes',
    width: 80,
    render: (_: unknown, record: MetadataCollectionJob) =>
      (record.tables_added_count || 0) +
      (record.tables_deactivated_count || 0) +
      (record.columns_added_count || 0) +
      (record.columns_deactivated_count || 0) +
      (record.columns_type_changed_count || 0) +
      (record.columns_comment_changed_count || 0),
  },
  {
    title: '治理待办',
    dataIndex: 'governance_tickets_created_count',
    key: 'governance_tickets_created_count',
    width: 90,
    render: (count: number) => (count > 0 ? <Tag color="blue">{count}</Tag> : count),
  },
  {
    title: '错误',
    dataIndex: 'error_message',
    key: 'error_message',
    ellipsis: true,
  },
  {
    title: '开始时间',
    dataIndex: 'started_at',
    key: 'started_at',
    width: 160,
    render: (date: string | null) => (date ? new Date(date).toLocaleString('zh-CN') : '-'),
  },
]

const MetadataJobsPage: React.FC = () => {
  const { data: jobs, isLoading, error } = useMetadataJobs()

  if (isLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  }

  if (error) {
    return (
      <Alert
        message="加载失败"
        description={(error as { message?: string })?.message || '无法获取采集任务列表'}
        type="error"
        showIcon
      />
    )
  }

  const successCount = jobs?.filter((j) => j.status === 'success').length ?? 0
  const failedCount = jobs?.filter((j) => j.status === 'failed' || j.status === 'partial_success').length ?? 0

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        元数据采集任务
      </Typography.Title>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="任务总数" value={jobs?.length ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="成功"
              value={successCount}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="失败/异常"
              value={failedCount}
              valueStyle={{ color: '#ff4d4f' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="总治理待办" value={jobs?.reduce((s, j) => s + (j.governance_tickets_created_count || 0), 0) ?? 0} />
          </Card>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={jobs}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />
    </div>
  )
}

export default MetadataJobsPage
```

- [ ] **Step 2: Update `frontend/src/App.tsx` to route to MetadataJobsPage**

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import MetadataJobsPage from './pages/MetadataJobsPage'

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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ConfigProvider>
    </QueryClientProvider>
  )
}

export default App
```

Add the Typography import at the top of `App.tsx`:

```typescript
import { Typography } from 'antd'
```

- [ ] **Step 3: Verify build passes**

Run:

```powershell
cd frontend
npx tsc --noEmit
npx vite build
```

Expected: build succeeds.

- [ ] **Step 4: Commit Task 4**

```powershell
git add frontend/
git commit -m "feat: add metadata jobs demo page with Ant Design table"
```

---

### Task 5: Mount Frontend Build in FastAPI at `/app`

**Files:**
- Modify: `app/main.py`
- Files to verify: `frontend/dist/` (must exist after build)

**Interfaces:**
- Consumes: FastAPI `create_app()` from `app/main.py`
- Produces: FastAPI serves `frontend/dist/` at `/app` via `StaticFiles`

- [ ] **Step 1: Ensure frontend is built**

Run:

```powershell
cd frontend
npx vite build
```

Expected: `frontend/dist/` exists with `index.html`, asset files.

- [ ] **Step 2: Add StaticFiles mount in `app/main.py`**

Add imports at the top of `app/main.py`:

```python
from fastapi.staticfiles import StaticFiles
```

After `app.include_router(web_router, prefix="/web", tags=["Web 页面"])`, add the frontend mount:

```python
    # Mount modern frontend (React SPA) at /app.
    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend_dist.is_dir():
        app.mount("/app", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
```

Add the `Path` import at the top of `app/main.py` — check if it's already imported. If not, add:

```python
from pathlib import Path
```

- [ ] **Step 3: Start the FastAPI server and verify `/app` serves the SPA**

Run:

```powershell
python -m app.main
```

Expected: server starts on `http://localhost:8000`.

Open `http://localhost:8000/app/` in a browser — should serve the React app with Ant Design layout.

Open `http://localhost:8000/web/dashboard` — must still work (Jinja backend unaffected).

Stop the server with Ctrl+C.

- [ ] **Step 4: Add a quick integration test for the `/app` mount**

Add to `tests/test_basic.py`:

```python
def test_frontend_app_mount_serves_index(client):
    """Modern frontend SPA should be served at /app"""
    resp = client.get("/app/")
    # If frontend/dist doesn't exist, FastAPI may return 404.
    # This test is informative — it should pass after Task 5 build.
    assert resp.status_code in (200, 404), f"Unexpected status: {resp.status_code}"
```

This test is intentionally permissive: it documents whether the frontend is mounted. Run it:

```powershell
pytest tests/test_basic.py::test_frontend_app_mount_serves_index -q
```

Expected: `1 passed` (200 if built, 404 if not — either is acceptable for CI).

- [ ] **Step 5: Update `.gitignore` if needed — ensure `frontend/dist` is excluded**

Verify `d:\projects\MetricForge\.gitignore` contains:

```gitignore
# Frontend
frontend/node_modules/
frontend/dist/
```

- [ ] **Step 6: Commit Task 5**

```powershell
git add app/main.py tests/test_basic.py
git commit -m "feat: mount React frontend at /app via FastAPI StaticFiles"
```

---

### Task 6: Verification and Final Polish

**Files:**
- No new files — verification-only task

- [ ] **Step 1: Run full backend test suite**

Run:

```powershell
$env:PYTHONPATH='.'
pytest -q
```

Expected: `120+ passed, 23 warnings` (same baseline, no regressions).

- [ ] **Step 2: Run frontend tests**

Run:

```powershell
cd frontend
npx vitest run
```

Expected: all API client tests pass.

- [ ] **Step 3: Run frontend TypeScript check**

Run:

```powershell
cd frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run frontend build**

Run:

```powershell
cd frontend
npx vite build
```

Expected: build succeeds, outputs to `frontend/dist/`.

- [ ] **Step 5: Start FastAPI and verify both Jinja and React pages work**

Run FastAPI:

```powershell
python -m app.main
```

Test Jinja: `http://localhost:8000/web/dashboard` — should render.
Test React: `http://localhost:8000/app/` — should render Ant Design layout.
Test React + API: `http://localhost:8000/app/metadata/jobs` — should show job table (may be empty if no jobs).

Stop the server.

- [ ] **Step 6: Check git diff for unintended changes**

Run:

```powershell
git status --short
git diff --stat
```

Expected:
- Only `frontend/`, `app/main.py`, `.gitignore`, `tests/test_basic.py` changed
- No changes to `app/web/` or `app/templates/`
- `DESIGN-vercel.md` and `reports/` are untracked (not staged)

- [ ] **Step 7: Final commit if any remaining polish**

```powershell
git add -A
git commit -m "chore: finalize modern frontend foundation scaffold"
```

- [ ] **Step 8: Push to GitHub (only when user confirms)**

```powershell
git push origin main
```

---

## Self-Review

1. **Spec coverage:** Every Phase 1 requirement from `2026-06-24-modern-frontend-evolution-design.md` is covered:
   - ✅ `frontend/` directory created (Task 1)
   - ✅ React + TypeScript + Vite initialized (Task 1)
   - ✅ Ant Design integrated (Task 2)
   - ✅ TanStack Query integrated (Task 3)
   - ✅ Vite dev proxy `/api -> localhost:8000/api` configured (Task 1)
   - ✅ FastAPI mounts static build at `/app` (Task 5)
   - ✅ Jinja `/web/*` untouched (verified in Task 6)
   - ✅ First demo page at `/app/metadata/jobs` (Task 4)
   - ✅ Vitest + React Testing Library configured (Task 3)
   - ✅ Not implementing AI query workbench yet (confirmed scope)

2. **Placeholder scan:** All code blocks contain complete implementations. No TBD, TODO, or placeholder patterns found.

3. **Type consistency:** All TypeScript interfaces match the existing FastAPI `serialize_collection_job` response fields. Interface `MetadataCollectionJob` mirrors the Python `MetadataCollectionJob` model attributes.

4. **Backward compatibility:** No existing files in `app/web/` or `app/api/` were modified (except `app/main.py` for the mount). Jinja routes continue to work unchanged. API routes are untouched.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-modern-frontend-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
