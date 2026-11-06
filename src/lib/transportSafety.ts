// Credentials may use HTTP only on the loopback interface during local testing.
export function securePageAllowed(protocol: string, hostname: string): boolean {
  return protocol === 'https:' || protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
