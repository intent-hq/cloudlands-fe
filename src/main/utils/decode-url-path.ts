
export function decodeUrlPath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\0')) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
