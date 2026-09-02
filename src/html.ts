/**
 * Every outgoing message uses HTML parse mode. Usernames containing _ or *
 * break MarkdownV2, so all user-supplied text goes through escapeHtml.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
