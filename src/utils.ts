export function chunkText(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += limit) {
    parts.push(chars.slice(i, i + limit).join(''));
  }
  return parts.length ? parts : [''];
}

export function truncateText(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('');
}

export function hashText(text: string): string {
  // Simple hash function for cache keys
  let hash = 0;
  if (text.length === 0) return hash.toString();
  
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}
