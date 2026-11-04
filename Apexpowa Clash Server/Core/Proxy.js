const net = require('net')
const fs = require('fs')
const path = require('path')
const RC4 = require('simple-rc4')

/**
 * Transparent logging proxy.
 *
 * Point a client (libg.so patched to this host/port) at the proxy and set
 * Proxy.UpstreamHost / UpstreamPort to a server that speaks the same RC4
 * protocol as ACS. Bytes are forwarded untouched; a copy is decrypted with the
 * same RC4 scheme as Crypto/index.js, split into packets and logged.
 */
class Proxy {
  constructor (options, messages, rc4Key) {
    this.options = options
    this.messages = messages
    this.rc4Key = rc4Key
    this.logFile = null
    if (options.LogToFile) {
      const dir = path.join(process.cwd(), 'ProxyLogs')
      fs.mkdirSync(dir, { recursive: true })
      this.logFile = path.join(dir, `proxy-${Date.now()}.log`)
    }
  }

  log (line) {
    console.log(line)
    if (this.logFile) fs.appendFileSync(this.logFile, line + '\n')
  }

  createStream () {
    const seed = Buffer.concat([Buffer.from(this.rc4Key), Buffer.from('nonce')])
    const stream = new RC4(seed)
    stream.update(seed) // same priming as Crypto/index.js
    return stream
  }

  nameOf (id) {
    const Packet = this.messages.handle(id)
    return Packet ? Packet.name : 'Unknown'
  }

  describe (direction, id, payload) {
    let extra = ''
    if (direction === 'C->S' && this.options.DecodeKnown) {
      const Packet = this.messages.handle(id)
      if (Packet) {
        try {
          const msg = new Packet(Buffer.from(payload), {})
          // decode() only parses; process() is never called, so nothing is executed.
          Promise.resolve(msg.decode()).then(() => {
            if (msg.data) this.log(`        decoded: ${JSON.stringify(msg.data, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`)
          }).catch(() => {})
        } catch (e) { /* ignore undecodable */ }
      }
    }
    return extra
  }

  feed (state, chunk, direction, tag) {
    state.buffer = Buffer.concat([state.buffer, chunk])
    while (state.buffer.length >= 7) {
      const id = state.buffer.readUInt16BE(0)
      const len = state.buffer.readUIntBE(2, 3)
      if (state.buffer.length < 7 + len) break
      const version = state.buffer.readUInt16BE(5)
      const encrypted = state.buffer.slice(7, 7 + len)
      state.buffer = state.buffer.slice(7 + len)

      const payload = state.stream.update(encrypted)
      const max = this.options.MaxPayloadBytes || 64
      this.log(`[${tag}] ${direction} ${id} ${this.nameOf(id)} len=${len} v=${version}`)
      if (this.options.DumpPayload) {
        this.log(`        hex: ${payload.slice(0, max).toString('hex')}${payload.length > max ? '...' : ''}`)
      }
      this.describe(direction, id, payload)
    }
  }

  start () {
    const upstreamHost = this.options.UpstreamHost
    const upstreamPort = this.options.UpstreamPort
    let counter = 0

    const server = net.createServer(client => {
      const tag = `#${++counter}`
      const upstream = net.connect(upstreamPort, upstreamHost)
      client.setNoDelay(true)
      upstream.setNoDelay(true)

      // Separate RC4 streams per direction, like Crypto/index.js.
      const c2s = { buffer: Buffer.alloc(0), stream: this.createStream() }
      const s2c = { buffer: Buffer.alloc(0), stream: this.createStream() }

      this.log(`[${tag}] client connected -> ${upstreamHost}:${upstreamPort}`)

      client.on('data', chunk => {
        upstream.write(chunk)
        try { this.feed(c2s, chunk, 'C->S', tag) } catch (e) { this.log(`[${tag}] parse error: ${e.message}`) }
      })
      upstream.on('data', chunk => {
        client.write(chunk)
        try { this.feed(s2c, chunk, 'S->C', tag) } catch (e) { this.log(`[${tag}] parse error: ${e.message}`) }
      })

      const close = () => { client.destroy(); upstream.destroy() }
      client.on('close', () => { this.log(`[${tag}] closed`); close() })
      upstream.on('close', close)
      client.on('error', close)
      upstream.on('error', e => { this.log(`[${tag}] upstream error: ${e.message}`); close() })
    })

    server.listen(this.options.Port, () => {
      this.log(`[PROXY] Listening on ${this.options.Port}, forwarding to ${upstreamHost}:${upstreamPort}`)
      if (this.logFile) this.log(`[PROXY] Logging to ${this.logFile}`)
    })
    return server
  }
}

module.exports = Proxy
