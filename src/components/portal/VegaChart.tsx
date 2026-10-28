'use client';

import { useEffect, useRef } from 'react';

import type { VegaLiteSpec } from '@/lib/contracts';

/** Renders a server-built Vega-Lite spec. Every plotted value is a verified fact. */
export function VegaChart({ spec }: { spec: VegaLiteSpec }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let view: { finalize: () => void } | undefined;
    let cancelled = false;
    (async () => {
      const embed = (await import('vega-embed')).default;
      if (cancelled || !el.current) return;
      const css = getComputedStyle(document.documentElement);
      const ink = css.getPropertyValue('--ink').trim();
      const muted = css.getPropertyValue('--ink-muted').trim();
      const harbour = css.getPropertyValue('--harbour').trim();
      const rule = css.getPropertyValue('--rule').trim();
      const result = await embed(el.current, { ...spec, width: 'container', height: 180, autosize: { type: 'fit', contains: 'padding' } } as never, {
        actions: false,
        renderer: 'svg',
        config: {
          background: 'transparent',
          font: 'Public Sans, system-ui, sans-serif',
          title: { anchor: 'start', fontSize: 13, fontWeight: 600, color: ink, offset: 10 },
          axis: { labelColor: muted, titleColor: muted, gridColor: rule, domainColor: rule, tickColor: rule, labelFontSize: 11, titleFontSize: 11, labelAngle: 0 },
          bar: { fill: harbour, cornerRadiusEnd: 2 },
          range: { category: [harbour, '#3f8f5a', '#a86a12', '#7a5aa6'] },
          legend: { labelColor: muted, titleColor: muted, orient: 'bottom' },
          view: { stroke: null },
        },
      });
      view = result.view;
    })();
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);
  return <div ref={el} className="chart" />;
}
