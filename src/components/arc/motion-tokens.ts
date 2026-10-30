// Adapted from Arc Library (MIT); see LICENSE. Short, non-overshooting control motion.
export const motionTokens = {
  duration: { instant: 0.12, fast: 0.16, standard: 0.24 },
  ease: { standard: [0.22, 1, 0.36, 1] },
  spring: { snappy: { type: "spring", visualDuration: 0.22, bounce: 0 } },
} as const;
