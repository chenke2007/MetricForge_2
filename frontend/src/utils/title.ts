export function generateTitle(question: string): string {
  if (!question || !question.trim()) return ''

  // Take first complete sentence (句号/问号/感叹号/换行/英文句号处截断)
  const match = question.match(/^(.+?[。？！\n.])/)
  let title = match ? match[1] : question

  // Limit max length (48 chars)
  if (title.length > 48) {
    title = title.slice(0, 48) + '…'
  }

  return title.trim()
}
