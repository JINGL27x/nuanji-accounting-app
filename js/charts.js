// SVG 圆形图（甜甜圈）
export function donutSVG(data, { size = 180, stroke = 26, centerText = '' } = {}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2, cy = size / 2;
  let segs = '';
  if (total <= 0) {
    segs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#E7D9CB" stroke-width="${stroke}"/>`;
  } else {
    let acc = 0;
    data.forEach((d) => {
      const v = Math.max(0, d.value);
      if (v <= 0) return;
      const len = (v / total) * c;
      segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${stroke}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      acc += len;
    });
  }
  let txt;
  if (total > 0) {
    txt = `<text x="${cx}" y="${cy - 3}" text-anchor="middle" style="font-size:12px;fill:var(--muted)">合计</text>` +
          `<text x="${cx}" y="${cy + 17}" text-anchor="middle" style="font-size:16px;font-weight:800;fill:var(--ink)">${centerText}</text>`;
  } else {
    txt = `<text x="${cx}" y="${cy + 5}" text-anchor="middle" style="font-size:13px;fill:var(--muted)">暂无数据</text>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="占比圆形图">${segs}${txt}</svg>`;
}
