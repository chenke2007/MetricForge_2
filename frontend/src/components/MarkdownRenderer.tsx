import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import SqlCodeBlock from './SqlCodeBlock'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const components: Components = {
    img() {
      return null
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const isSql =
        match?.[1]?.toLowerCase() === 'sql' ||
        match?.[1]?.toLowerCase() === 'mysql' ||
        match?.[1]?.toLowerCase() === 'postgresql'

      if (isSql) {
        return (
          <SqlCodeBlock
            code={String(children).replace(/\n$/, '')}
            language={match![1]}
          />
        )
      }

      if (match) {
        return (
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, overflow: 'auto' }}>
            <code className={className} {...props}>
              {String(children).replace(/\n$/, '')}
            </code>
          </pre>
        )
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    },
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
