// Supplier names carry branch and district qualifiers, e.g. "浙江省博物馆(孤山馆区)"
// for the query "浙江省博物馆孤山馆区". Matching must survive that spelling noise
// without ever treating two different venues as one.
export function normalizePlaceName(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•・\-—_,，、()（）[\]【】「」『』<>《》"“”'‘’]/gu, "");
}

function namesMatch(query: string, candidate: string): boolean {
  const left = normalizePlaceName(query);
  const right = normalizePlaceName(candidate);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 2 && longer.startsWith(shorter);
}

// Exact spelling wins so that "楼外楼" is not ambiguous with its branch names.
// Qualifier matches only apply when nothing matches exactly, and the caller still
// requires a single result before treating the venue as identified.
export function matchingByName<T>(
  query: string,
  items: readonly T[],
  nameOf: (item: T) => string,
): T[] {
  const exact = items.filter(
    (item) => normalizePlaceName(nameOf(item)) === normalizePlaceName(query),
  );
  return exact.length ? exact : items.filter((item) => namesMatch(query, nameOf(item)));
}
