/**
 * Who receives push alerts for new customer messages.
 *
 * `profiles.push_notify` is set by an admin per member (members tab).
 * While it is NULL the role decides: owner and admin are notified, everyone
 * else is not.
 */
export function isPushRecipient(
  pushNotify: boolean | null | undefined,
  role: string | null | undefined,
): boolean {
  if (pushNotify === true) return true;
  if (pushNotify === false) return false;
  return role === 'owner' || role === 'admin';
}
