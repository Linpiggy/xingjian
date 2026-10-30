// Adapted from Arc Library (MIT); see LICENSE. Short, non-overshooting control motion.
// 只增补上游存在、本轮组件需要的预设；已有取值保持不变，避免影响已适配组件的手感。
export const motionTokens = {
  duration: { instant: 0.12, fast: 0.16, exit: 0.18, standard: 0.24, considered: 0.48 },
  ease: {
    standard: [0.22, 1, 0.36, 1],
    enter: [0.16, 1, 0.3, 1],
    exit: [0.7, 0, 0.84, 0],
    inOut: [0.65, 0, 0.35, 1],
  },
  spring: {
    snappy: { type: "spring", visualDuration: 0.22, bounce: 0 },
    smooth: { type: "spring", visualDuration: 0.4, bounce: 0 },
    morph: { type: "spring", visualDuration: 0.42, bounce: 0 },
    responsive: { type: "spring", stiffness: 520, damping: 44 },
    gentle: { type: "spring", stiffness: 340, damping: 34 },
  },
  stagger: { char: 0.016, word: 0.04, line: 0.08, item: 0.035 },
  blur: { subtle: 2, soft: 4, text: 8 },
} as const;
