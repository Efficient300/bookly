import type { ComponentType, SVGProps } from 'react';
import type { Format } from '../../../shared/types.ts';
import { IconBolt, IconCup, IconFork, IconGlass, IconHome, IconSparkles, IconWalk } from '../components/icons.tsx';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** Цвет и значок сходки по её формату: обложка, плитка в списках. */
export const FORMAT_THEME: Record<Format, { from: string; to: string; Icon: Icon }> = {
  eat: { from: '#FF9500', to: '#FF2D55', Icon: IconFork },
  coffee: { from: '#B98A5E', to: '#6B4226', Icon: IconCup },
  bar: { from: '#BF5AF2', to: '#5856D6', Icon: IconGlass },
  active: { from: '#30D158', to: '#00A896', Icon: IconBolt },
  walk: { from: '#32ADE6', to: '#007AFF', Icon: IconWalk },
  home: { from: '#FFB340', to: '#FF6B00', Icon: IconHome },
  any: { from: '#5E5CE6', to: '#0A84FF', Icon: IconSparkles },
};
