import { lookup } from 'node:dns/promises'
import net from 'node:net'

/**
 * The mailbox host is typed by an account admin and then dialled from our
 * server, so it must not be usable to probe the private network
 * (localhost, 10.x, 192.168.x, the cloud metadata address, ...). Hostnames
 * are resolved and every returned address is checked.
 */

export class EmailHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailHostError'
  }
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast / reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase()
  if (v === '::1' || v === '::') return true
  if (v.startsWith('fc') || v.startsWith('fd')) return true // unique local
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true // link-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip)
  if (kind === 4) return isPrivateIPv4(ip)
  if (kind === 6) return isPrivateIPv6(ip)
  return true
}

/** Throws EmailHostError unless `host` is a public hostname/IP. */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.trim().toLowerCase()
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    throw new EmailHostError('invalid_host')
  }
  if (net.isIP(h)) {
    if (isPrivateAddress(h)) throw new EmailHostError('private_host')
    return
  }
  let addresses: { address: string }[]
  try {
    addresses = await lookup(h, { all: true })
  } catch {
    throw new EmailHostError('unresolvable_host')
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new EmailHostError('private_host')
  }
}

/** Strip a scheme/path someone may paste: "imaps://imap.x.com/" → "imap.x.com". */
export function cleanHost(input: string): string {
  return input
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
}
