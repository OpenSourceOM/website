// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const fontDir = join(process.cwd(), 'src/assets/fonts');
const fonts = [
  {
    name: 'IBM Plex Sans',
    data: readFileSync(join(fontDir, 'IBMPlexSans-Regular.ttf')),
    weight: 400 as const,
    style: 'normal' as const,
  },
  {
    name: 'IBM Plex Sans',
    data: readFileSync(join(fontDir, 'IBMPlexSans-SemiBold.ttf')),
    weight: 600 as const,
    style: 'normal' as const,
  },
  {
    name: 'IBM Plex Sans',
    data: readFileSync(join(fontDir, 'IBMPlexSans-Bold.ttf')),
    weight: 700 as const,
    style: 'normal' as const,
  },
];

type Style = Record<string, string | number>;
type Node = {
  type: string;
  props: {
    style?: Style;
    children?: Node | Node[] | string;
    src?: string;
    width?: number;
    height?: number;
  };
};

function el(
  type: string,
  style: Style,
  children?: Node | Node[] | string,
  extra?: { src?: string; width?: number; height?: number },
): Node {
  return { type, props: { style, children, ...extra } };
}

function div(style: Style, children?: Node | Node[] | string): Node {
  return el('div', { display: 'flex', ...style }, children);
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, '').trim()}…`;
}

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#0D1420" stroke="#1E293B"/>
  <circle cx="16" cy="16" r="5" stroke="#22D3EE" stroke-width="2"/>
  <circle cx="9" cy="10" r="2" fill="#6366F1"/>
  <circle cx="23" cy="10" r="2" fill="#A855F7"/>
  <circle cx="23" cy="22" r="2" fill="#22D3EE"/>
  <circle cx="9" cy="22" r="2" fill="#F87171"/>
</svg>`;

const graphSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360" fill="none">
  <line x1="180" y1="180" x2="58" y2="64" stroke="#334155" stroke-width="2"/>
  <line x1="180" y1="180" x2="300" y2="72" stroke="#334155" stroke-width="2"/>
  <line x1="180" y1="180" x2="312" y2="228" stroke="#334155" stroke-width="2"/>
  <line x1="180" y1="180" x2="72" y2="268" stroke="#334155" stroke-width="2"/>
  <line x1="180" y1="180" x2="180" y2="318" stroke="#334155" stroke-width="2"/>
  <circle cx="180" cy="180" r="52" fill="#0d1420" stroke="url(#g)" stroke-width="3"/>
  <circle cx="180" cy="180" r="9" fill="#22d3ee"/>
  <circle cx="58" cy="64" r="16" fill="#6366f1"/>
  <circle cx="300" cy="72" r="16" fill="#a855f7"/>
  <circle cx="312" cy="228" r="16" fill="#22d3ee"/>
  <circle cx="72" cy="268" r="16" fill="#f87171"/>
  <circle cx="180" cy="318" r="16" fill="#34d399"/>
  <defs>
    <linearGradient id="g" x1="128" y1="128" x2="232" y2="232" gradientUnits="userSpaceOnUse">
      <stop stop-color="#22d3ee"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
</svg>`;

function svgImage(svg: string, width: number, height: number): Node {
  return el('img', { width, height }, undefined, {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  });
}

export function ogKicker(tags: string[], focusKeyword?: string): string {
  const candidates = [focusKeyword, ...tags, 'Blog'];
  for (const candidate of candidates) {
    const raw = candidate?.trim();
    if (raw && raw.length <= 46) return raw;
  }
  return 'Blog';
}

export async function renderOgPng(input: {
  title: string;
  description?: string;
  kicker?: string;
}): Promise<Buffer> {
  const title = input.title.trim();
  const description = input.description ? shorten(input.description, 130) : '';
  const kicker = (input.kicker || 'Blog').toUpperCase();
  const titleSize = title.length > 92 ? 46 : title.length > 68 ? 52 : 58;

  const tree = div(
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      backgroundColor: '#070b12',
      color: '#e2e8f0',
      fontFamily: 'IBM Plex Sans',
      position: 'relative',
    },
    [
      div({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 8,
        backgroundImage: 'linear-gradient(90deg, #22d3ee 0%, #6366f1 55%, #a855f7 100%)',
      }),
      div({
        position: 'absolute',
        top: 80,
        right: -40,
        width: 420,
        height: 420,
        borderRadius: 9999,
        backgroundImage: 'radial-gradient(circle, rgba(34,211,238,0.16) 0%, rgba(34,211,238,0) 68%)',
      }),
      div(
        {
          width: '100%',
          height: '100%',
          padding: '64px 68px 56px',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        [
          div(
            {
              width: 740,
              height: '100%',
              flexDirection: 'column',
              justifyContent: 'space-between',
            },
            [
              div({ alignItems: 'center' }, [
                svgImage(logoSvg, 52, 52),
                div({ marginLeft: 16, alignItems: 'baseline' }, [
                  div({ fontSize: 28, fontWeight: 700, color: '#e2e8f0' }, 'OpenSource'),
                  div({ fontSize: 28, fontWeight: 700, color: '#22d3ee' }, 'OM'),
                ]),
              ]),
              div({ flexDirection: 'column', width: 740 }, [
                div(
                  {
                    alignSelf: 'flex-start',
                    fontSize: 18,
                    fontWeight: 600,
                    letterSpacing: 1.4,
                    color: '#22d3ee',
                    backgroundColor: '#0d1420',
                    border: '1px solid #1e293b',
                    borderRadius: 999,
                    padding: '8px 16px',
                  },
                  kicker,
                ),
                div(
                  {
                    marginTop: 22,
                    width: 740,
                    fontSize: titleSize,
                    fontWeight: 700,
                    lineHeight: 1.12,
                    letterSpacing: -1.1,
                    color: '#f8fafc',
                  },
                  title,
                ),
                description
                  ? div(
                      {
                        marginTop: 22,
                        width: 700,
                        fontSize: 26,
                        fontWeight: 400,
                        lineHeight: 1.35,
                        color: '#94a3b8',
                      },
                      description,
                    )
                  : div({}),
              ]),
              div({ fontSize: 22, fontWeight: 600, color: '#64748b' }, 'opensourceom.org'),
            ],
          ),
          div({ alignItems: 'center', justifyContent: 'center', width: 300 }, [
            svgImage(graphSvg, 300, 300),
          ]),
        ],
      ),
    ],
  );

  const svg = await satori(tree, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });
  return new Resvg(svg).render().asPng();
}
