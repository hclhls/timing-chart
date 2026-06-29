// Serialize a rendered WaveDrom <svg> into a standalone SVG document string.

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/**
 * Produce a self-contained SVG string from a live <svg> element. Pass `bg` to
 * paint a background rect — essential for the dark skin, whose text is white and
 * otherwise vanishes on a white page (the WaveDrom SVG is itself transparent).
 * A white `bg` is skipped so default-skin exports stay transparent as before.
 */
export function svgToString(svg: SVGSVGElement, bg?: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS)
  if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', XLINK_NS)
  if (bg && bg.toLowerCase() !== '#ffffff' && bg.toLowerCase() !== '#fff') {
    const rect = clone.ownerDocument.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', '100%')
    rect.setAttribute('height', '100%')
    rect.setAttribute('fill', bg)
    clone.insertBefore(rect, clone.firstChild)
  }
  const body = new XMLSerializer().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`
}

/** Width/height in px of a rendered SVG, from width/height attrs or viewBox. */
export function svgPixelSize(svg: SVGSVGElement): { width: number; height: number } {
  const w = parseFloat(svg.getAttribute('width') ?? '')
  const h = parseFloat(svg.getAttribute('height') ?? '')
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h }
  }
  const vb = svg.getAttribute('viewBox')
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number)
    if (parts.length === 4) return { width: parts[2], height: parts[3] }
  }
  const rect = svg.getBoundingClientRect()
  return { width: rect.width || 600, height: rect.height || 200 }
}
