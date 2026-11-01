/** Content may hold paths on the API host, such as /media/…: those become absolute URLs. */
export const mediaUrl = (apiUrl: string, src: string) => (src.startsWith("/") && !src.startsWith("//") ? `${new URL(apiUrl).origin}${src}` : src);
