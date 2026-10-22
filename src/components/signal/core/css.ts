/**
 * 尺寸 prop → CSS 值。
 * 数字按 px，字符串原样返回（支持 '100%'、'calc(...)'、'auto' 等），
 * 便于宿主用 flex/grid 布局而不必给组件传具体像素。
 */
export function cssSize(value: number | string | undefined | null, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback
  return typeof value === 'number' ? `${value}px` : value
}
