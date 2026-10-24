/** The canvas as a PNG blob (signatures). */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty canvas'))), 'image/png'))
}
