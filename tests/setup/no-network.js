// Tests never reach the network: any connection to a host other than the loopback is refused,
// and fails the test that made it. Requests answered by msw never open a connection, and local
// test servers (127.0.0.1) are allowed. A check that carries on after a failed lookup would
// otherwise hide the attempt, so it is recorded and checked after each test.
import net from 'node:net'
import { afterEach, expect } from 'vitest'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'])
const blocked = []

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const [opts] = args
  const options = Array.isArray(opts) ? (opts[0] ?? {}) : opts
  // -> connect(options), connect(port[, host]) or connect(path) for an IPC socket
  const host = typeof options === 'object' && options !== null
    ? (options.path ? null : (options.host ?? 'localhost'))
    : (typeof options === 'string' && Number.isNaN(Number(options)) ? null : (typeof args[1] === 'string' ? args[1] : 'localhost'))
  if (host !== null && !LOOPBACK.has(host)) {
    const port = typeof options === 'object' ? options.port : options
    blocked.push(`${host}:${port}`)
    const err = new Error(`Network access in tests is blocked: ${host}:${port}`)
    err.code = 'ENETUNREACH'
    process.nextTick(() => this.destroy(err))
    return this
  }
  return connect.apply(this, args)
}

afterEach(() => {
  const attempts = blocked.splice(0)
  expect(attempts, 'connections to the network').toEqual([])
})
