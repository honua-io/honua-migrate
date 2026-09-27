export function removeArcGisCdnScriptTags(source: string): string {
  const openTagPattern = /<script\b[^>]*>/gi;
  const closeTagPattern = /<\/script\b[^>]*>/gi;
  const removals: Array<{ start: number; end: number }> = [];
  let openTag = openTagPattern.exec(source);
  while (openTag !== null) {
    const attributes = openTag[0].slice("<script".length, -1);
    if (/\bsrc\s*=\s*["']%CDN%["']/i.test(attributes)) {
      closeTagPattern.lastIndex = openTag.index + openTag[0].length;
      const closeTag = closeTagPattern.exec(source);
      if (closeTag !== null) {
        removals.push({ start: openTag.index, end: closeTag.index + closeTag[0].length });
        openTagPattern.lastIndex = closeTag.index + closeTag[0].length;
      }
    }
    openTag = openTagPattern.exec(source);
  }
  let next = source;
  for (const removal of removals.reverse()) {
    next = `${next.slice(0, removal.start)}${next.slice(removal.end)}`;
  }
  return next;
}
