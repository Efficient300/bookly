import type { ComponentType, SVGProps } from 'react';
import type { Format } from '../../../shared/types.ts';
import { IconBolt, IconCup, IconFork, IconGlass, IconHome, IconSparkles, IconWalk } from '../components/icons.tsx';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** Значок формата: категории отличаются иконкой, а не цветом. */
export const FORMAT_ICON: Record<Format, Icon> = {
  eat: IconFork,
  coffee: IconCup,
  bar: IconGlass,
  active: IconBolt,
  walk: IconWalk,
  home: IconHome,
  any: IconSparkles,
};
