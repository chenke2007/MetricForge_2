import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Typography, Result, Button } from 'antd'
import GovernanceList from '../components/GovernanceList'
import GovernanceFilterBar from '../components/GovernanceFilterBar'
import GovernanceDetailDrawer from '../components/GovernanceDetailDrawer'
import { useGovernanceTickets } from '../hooks/useGovernanceTickets'
import type { GovernanceFilters, ApiErrorLike } from '../api/governance'

const PAGE_SIZE = 20

const GovernancePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  // Read filters from URL
  const filters: GovernanceFilters = {
    status: searchParams.get('status') || undefined,
    ticket_type: searchParams.get('ticket_type') || undefined,
    source: searchParams.get('source') || undefined,
    page: Number(searchParams.get('page')) || 1,
    per_page: PAGE_SIZE,
  }

  const { data, isLoading, isError, error, refetch } = useGovernanceTickets(filters)

  const [selectedTicketId, setSelectedTicketId] = React.useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const updateFilters = (newFilters: Partial<GovernanceFilters>) => {
    const params = new URLSearchParams(searchParams)
    const merged = { ...filters, ...newFilters, page: newFilters.page ?? 1 }
    // Remove governance filter keys that are being cleared
    ;(['status', 'ticket_type', 'source', 'page', 'per_page'] as const).forEach((key) => {
      params.delete(key)
    })
    Object.entries(merged).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        // Do not include per_page when it equals the default
        if (key === 'per_page' && value === PAGE_SIZE) {
          return
        }
        params.set(key, String(value))
      }
    })
    setSearchParams(params, { replace: true })
  }

  const handleFilterChange = (values: GovernanceFilters) => {
    updateFilters(values)
  }

  const handleReset = () => {
    setSearchParams({}, { replace: true })
  }

  const handleSelect = (ticketId: number) => {
    setSelectedTicketId(ticketId)
    setDrawerOpen(true)
  }

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const handleCloseDrawer = () => {
    setDrawerOpen(false)
    // Delay clearing ticketId to avoid flicker during drawer close animation
    timeoutRef.current = setTimeout(() => setSelectedTicketId(null), 300)
  }

  const handlePageChange = (page: number) => {
    updateFilters({ page })
  }

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        治理待办
      </Typography.Title>

      <GovernanceFilterBar
        values={{
          status: filters.status,
          ticket_type: filters.ticket_type,
          source: filters.source,
        }}
        onChange={handleFilterChange}
        onReset={handleReset}
      />

      {isError ? (
        <Result
          status="error"
          title="加载失败"
          subTitle={(error as ApiErrorLike)?.message || '无法获取治理待办列表'}
          extra={<Button onClick={() => refetch()}>重试</Button>}
        />
      ) : (
        <GovernanceList
          items={data?.items || []}
          pagination={{
            page: data?.pagination.page || 1,
            total: data?.pagination.total || 0,
            total_pages: data?.pagination.total_pages || 0,
          }}
          loading={isLoading}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          onSelect={handleSelect}
        />
      )}

      <GovernanceDetailDrawer
        open={drawerOpen}
        ticketId={selectedTicketId}
        onClose={handleCloseDrawer}
      />
    </div>
  )
}

export default GovernancePage
