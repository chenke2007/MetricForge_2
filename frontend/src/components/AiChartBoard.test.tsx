import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AiChartBoard from './AiChartBoard'
import type { AiChartSpec } from '../types/aiAsk'

// Mock ChartCard to simplify test rendering
vi.mock('./ChartCard', () => ({
  default: ({ spec, isActive, onSelect, columnTypes }: any) => (
    <div
      data-testid={`chart-card-${spec.title}`}
      data-active={isActive ? 'true' : 'false'}
      data-column-types={(columnTypes ?? []).join(',')}
      data-xfield={spec.xField ?? ''}
      data-yfields={(spec.yFields ?? []).join(',')}
      onClick={onSelect}
    >
      {spec.title}
    </div>
  ),
}))

const suggestions: AiChartSpec[] = [
  {
    title: '各区域销售额排行',
    chartType: 'bar',
    xField: 'region',
    yFields: ['total_revenue'],
    rationale: '柱状图直观对比各区域销售额',
    limitations: [],
  },
  {
    title: '各区域毛利率对比',
    chartType: 'bar',
    xField: 'region',
    yFields: ['gross_margin'],
    rationale: '毛利率横向对比',
    limitations: [],
  },
  {
    title: '销售额占比分布',
    chartType: 'pie',
    xField: 'region',
    yFields: ['total_revenue'],
    rationale: '饼图展示占比结构',
    limitations: [],
  },
]

const metricCardSuggestion: AiChartSpec = {
  title: '核心指标总览',
  chartType: 'metric-card',
  yFields: [],
  metricCards: [
    { label: '总营收', value: '9999万亿', change: '+999%', changeDirection: 'up', icon: 'revenue' },
    { label: '毛利率', value: '99.9%', change: '+99%', changeDirection: 'up', icon: 'rate' },
  ],
  rationale: 'mock metric cards with fabricated values',
  limitations: [],
}

const mockData = {
  columns: ['region', 'total_revenue', 'gross_margin'],
  rows: [
    ['华东', 12300000, 32.5],
    ['华南', 9800000, 28.7],
  ],
}

describe('AiChartBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders board title with chart count', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('AI 图表建议')).toBeInTheDocument()
    expect(screen.getByText(/共 3 种视角/)).toBeInTheDocument()
  })

  it('renders all chart suggestions', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
    expect(screen.getByText('各区域毛利率对比')).toBeInTheDocument()
    expect(screen.getByText('销售额占比分布')).toBeInTheDocument()
  })

  it('shows empty state when no suggestions', () => {
    render(
      <AiChartBoard
        chartSuggestions={[]}
        columns={[]}
        rows={[]}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('暂无图表建议')).toBeInTheDocument()
    expect(screen.queryByText('AI 图表建议')).not.toBeInTheDocument()
  })

  it('calls onActiveChange when a chart card is clicked', () => {
    const onChange = vi.fn()
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={onChange}
      />
    )
    fireEvent.click(screen.getByText('各区域毛利率对比'))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('marks the active chart card', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={1}
        onActiveChange={() => {}}
      />
    )
    const activeCard = screen.getByTestId('chart-card-各区域毛利率对比')
    const inactiveCard = screen.getByTestId('chart-card-各区域销售额排行')
    expect(activeCard.getAttribute('data-active')).toBe('true')
    expect(inactiveCard.getAttribute('data-active')).toBe('false')
  })

  it('handles null/undefined suggestions gracefully', () => {
    render(
      <AiChartBoard
        chartSuggestions={null as any}
        columns={[]}
        rows={[]}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('暂无图表建议')).toBeInTheDocument()
  })
})

// --- Phase 5M: Narrative Trust — sql_pending placeholder ---

describe('AiChartBoard Phase 5M Narrative Trust', () => {
  it('shows placeholder text when narrativeLevel is sql_pending', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="sql_pending"
      />
    )
    expect(screen.getByText('⏳ 待 SQL Workbench 验证后展示')).toBeInTheDocument()
  })

  it('does NOT render chart cards when narrativeLevel is sql_pending', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="sql_pending"
      />
    )
    expect(screen.queryByText('各区域销售额排行')).not.toBeInTheDocument()
    expect(screen.queryByText('各区域毛利率对比')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chart-card-各区域销售额排行')).not.toBeInTheDocument()
  })

  it('does NOT show "{n} 种视角" count when sql_pending', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="sql_pending"
      />
    )
    expect(screen.queryByText(/共 \d+ 种视角/)).not.toBeInTheDocument()
  })

  it('renders normal chart cards when narrativeLevel is executed', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
    expect(screen.getByText('各区域毛利率对比')).toBeInTheDocument()
    expect(screen.getByText(/共 3 种视角/)).toBeInTheDocument()
    expect(screen.queryByText('⏳ 待 SQL Workbench 验证后展示')).not.toBeInTheDocument()
  })

  it('renders normal chart cards when narrativeLevel is undefined (backward compat)', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
    expect(screen.getByText(/共 3 种视角/)).toBeInTheDocument()
    expect(screen.queryByText('⏳ 待 SQL Workbench 验证后展示')).not.toBeInTheDocument()
  })
})

// ── Phase 5N: executed with empty queryResult ─────────────────────────

describe('AiChartBoard Phase 5N executed empty queryResult', () => {
  it('returns null when executed with empty rows (page shows message once)', () => {
    const { container } = render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
        queryResult={{ columns: ['a'], rows: [], rowCount: 0, truncated: false, elapsedMs: 100, historyId: null }}
      />
    )
    expect(container.textContent).toBe('')
    expect(screen.queryByText('查询成功但无数据')).not.toBeInTheDocument()
  })

  it('still shows sql_pending placeholder when narrativeLevel is sql_pending', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="sql_pending"
        queryResult={undefined}
      />
    )
    expect(screen.getByText('⏳ 待 SQL Workbench 验证后展示')).toBeInTheDocument()
    expect(screen.queryByText('查询成功但无数据')).not.toBeInTheDocument()
  })
})
// --- Phase 5N follow-up: chart field matching ---

describe('AiChartBoard Phase 5N field matching', () => {
  const allMatchCols = ['region', 'total_revenue', 'gross_margin']
  const realRows = [['east', 100], ['west', 200]]

  it('renders only field-matching chart cards', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={allMatchCols}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
    expect(screen.getByText('各区域毛利率对比')).toBeInTheDocument()
    expect(screen.getByText('销售额占比分布')).toBeInTheDocument()
  })

  it('filters out chart when xField is missing', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={['total_revenue', 'gross_margin']}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
      />
    )
    expect(screen.queryByText('各区域销售额排行')).not.toBeInTheDocument()
    expect(screen.getByText('图表字段与查询结果不匹配，请查看查询结果表')).toBeInTheDocument()
  })

  it('filters out chart when any yField is missing', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={['region', 'total_revenue']}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
    expect(screen.queryByText('各区域毛利率对比')).not.toBeInTheDocument()
    expect(screen.getByText('销售额占比分布')).toBeInTheDocument()
  })

  it('uses real rows data for matching chart cards', () => {
    render(
      <AiChartBoard
        chartSuggestions={[suggestions[0]]}
        columns={allMatchCols}
        rows={realRows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
  })

  it('matches fields case-insensitively', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={['REGION', 'TOTAL_REVENUE', 'GROSS_MARGIN']}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
    expect(screen.getByText('各区域毛利率对比')).toBeInTheDocument()
  })

  it('shows fallback message when all suggestions filtered out', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={['a', 'b', 'c']}
        rows={[]}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
      />
    )
    expect(screen.getByText('图表字段与查询结果不匹配，请查看查询结果表')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-card-各区域销售额排行')).not.toBeInTheDocument()
  })
})

// ── Phase 5N Task 6.5D: columnTypes pass-through ──────────────────────

describe('AiChartBoard columnTypes pass-through', () => {
  it('forwards queryResult.columnTypes to ChartCard', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
        queryResult={{
          columns: mockData.columns,
          rows: mockData.rows,
          rowCount: 2,
          truncated: false,
          elapsedMs: 10,
          historyId: null,
          columnTypes: ['string', 'decimal', 'float'],
        }}
      />
    )
    expect(
      screen.getByTestId('chart-card-各区域销售额排行').getAttribute('data-column-types'),
    ).toBe('string,decimal,float')
  })
})

// ── Phase 5N Task 6.5D follow-up: executed metric-card blocking ────────
// executed + queryResult 时，metric-card 的虚构 value 不得出现在 DOM
// sql_pending / legacy 测试行为按现有兼容边界保持

describe('AiChartBoard executed metric-card blocking', () => {
  it('does NOT render metric-card spec when executed with queryResult', () => {
    render(
      <AiChartBoard
        chartSuggestions={[metricCardSuggestion]}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
        queryResult={{
          columns: mockData.columns,
          rows: mockData.rows,
          rowCount: 2,
          truncated: false,
          elapsedMs: 100,
          historyId: null,
        }}
      />
    )
    // metric-card spec 应被过滤，不出现在 DOM 中
    expect(screen.queryByTestId('chart-card-核心指标总览')).not.toBeInTheDocument()
    // 虚构 value 不得出现
    expect(screen.queryByText('9999万亿')).not.toBeInTheDocument()
    expect(screen.queryByText('99.9%')).not.toBeInTheDocument()
  })

  it('renders metric-card spec when narrativeLevel is undefined (backward compat)', () => {
    render(
      <AiChartBoard
        chartSuggestions={[metricCardSuggestion]}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByTestId('chart-card-核心指标总览')).toBeInTheDocument()
  })

  it('renders metric-card spec when narrativeLevel is sql_pending (placeholder)', () => {
    render(
      <AiChartBoard
        chartSuggestions={[metricCardSuggestion]}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="sql_pending"
      />
    )
    // sql_pending 显示占位符，不渲染 metric-card
    expect(screen.getByText('⏳ 待 SQL Workbench 验证后展示')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-card-核心指标总览')).not.toBeInTheDocument()
  })
})

// ── Phase 5N Task 6.5D follow-up: canonical field passthrough ─────────
// AiChartBoard 传给 ChartCard 的 spec 必须使用 queryResult.columns 中的真实大小写

describe('AiChartBoard canonical field passthrough', () => {
  it('passes canonical (uppercase) field names to ChartCard', () => {
    render(
      <AiChartBoard
        chartSuggestions={[
          {
            title: '区域金额',
            chartType: 'bar',
            xField: 'region',
            yFields: ['total_amount'],
            rationale: '',
            limitations: [],
          },
        ]}
        columns={[]}
        rows={[]}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
        queryResult={{
          columns: ['REGION', 'TOTAL_AMOUNT'],
          rows: [['华东', 123.45]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 100,
          historyId: null,
          columnTypes: ['string', 'decimal'],
        }}
      />
    )
    const card = screen.getByTestId('chart-card-区域金额')
    expect(card.getAttribute('data-xfield')).toBe('REGION')
    expect(card.getAttribute('data-yfields')).toBe('TOTAL_AMOUNT')
  })

  it('canonicalizes sort.field to real column name', () => {
    render(
      <AiChartBoard
        chartSuggestions={[
          {
            title: '区域金额排序',
            chartType: 'bar',
            xField: 'region',
            yFields: ['total_amount'],
            sort: { field: 'total_amount', direction: 'desc' },
            rationale: '',
            limitations: [],
          },
        ]}
        columns={[]}
        rows={[]}
        activeIndex={0}
        onActiveChange={() => {}}
        narrativeLevel="executed"
        queryResult={{
          columns: ['REGION', 'TOTAL_AMOUNT'],
          rows: [['华东', 123.45]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 100,
          historyId: null,
        }}
      />
    )
    // ChartCard should be rendered with canonical fields
    const card = screen.getByTestId('chart-card-区域金额排序')
    expect(card.getAttribute('data-xfield')).toBe('REGION')
    expect(card.getAttribute('data-yfields')).toBe('TOTAL_AMOUNT')
  })
})
