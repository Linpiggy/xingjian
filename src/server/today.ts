import { cache } from "react";

// React cache is scoped to the RSC request: one serialized date per request,
// not an impure clock read during client rendering or a stale module-level date.
export const todayInShanghai = cache(() =>
  new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
);
