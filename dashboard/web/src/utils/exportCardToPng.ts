/**
 * 将 DOM 节点导出为 PNG（用于报销截图）
 */
import html2canvas from 'html2canvas'

export interface ExportPngOptions {
  filename: string
  scale?: number
}

export async function exportElementToPng(
  element: HTMLElement,
  options: ExportPngOptions,
): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: options.scale ?? 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
  })
  const dataUrl = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  link.download = options.filename.endsWith('.png')
    ? options.filename
    : `${options.filename}.png`
  link.href = dataUrl
  link.click()
}

export async function exportManyElementsToPng(
  elements: { element: HTMLElement; filename: string }[],
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < elements.length; i++) {
    const { element, filename } = elements[i]
    onProgress?.(i + 1, elements.length)
    await exportElementToPng(element, { filename })
    if (i < elements.length - 1) {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}

export function sanitizeFilenamePart(s: string): string {
  return s.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').replace(/_+/g, '_')
}
