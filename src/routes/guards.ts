/** Session lifecycle belongs to the remarketing backend, not to sales. */
export function isAdmin(c: { get: (key: 'role') => string }): boolean {
  return c.get('role') === 'admin'
}
