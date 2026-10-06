// The abyss world's sim surface: real-scale constants, the analytic terrain
// model, the named regions with their streaming tiles, and the rule-built city
// layout with the street plan and ground surfaces under it. Consumers outside
// this directory import from here, never from a module file. See ./CLAUDE.md.

export {
  ABYSS_CAMPS,
  ABYSS_MAILBOXES,
  abyssRoads,
  buildAbyssProps,
} from './city_layout';
export * from './city_plan';
export * from './geometry';
export * from './regions';
export { abyssSurfaceAt } from './surface';
export * from './terrain';
