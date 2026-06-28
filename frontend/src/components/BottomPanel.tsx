import React from 'react'
import { Tabs } from 'antd'
import { HistoryOutlined, FileTextOutlined } from '@ant-design/icons'
import HistoryList from './HistoryList'
import DraftList from './DraftList'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const BottomPanel: React.FC = () => {
  const bottomTab = useSqlWorkbenchStore((s) => s.bottomTab)
  const setBottomTab = useSqlWorkbenchStore((s) => s.setBottomTab)

  return (
    <div style={{ marginTop: 12 }}>
      <Tabs
        activeKey={bottomTab}
        onChange={(key) => setBottomTab(key as 'history' | 'drafts')}
        items={[
          {
            key: 'history',
            label: (
              <span>
                <HistoryOutlined /> 查询历史
              </span>
            ),
            children: <HistoryList />,
          },
          {
            key: 'drafts',
            label: (
              <span>
                <FileTextOutlined /> 我的草稿
              </span>
            ),
            children: <DraftList />,
          },
        ]}
      />
    </div>
  )
}

export default BottomPanel
