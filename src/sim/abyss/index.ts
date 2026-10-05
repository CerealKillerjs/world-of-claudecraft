// The abyss world's sim surface: real-scale constants, the analytic terrain
// model, the named regions with their streaming tiles, and the rule-built city
// layout. Consumers outside this directory import from here, never from a
// module file. See ./CLAUDE.md.

export {
  ABYSS_CAMPS,
  ABYSS_MAILBOXES,
  abyssRoads,
  buildAbyssProps,
} from './city_layout';
export * from './geometry';
export * from './regions';
export * from './terrain';
