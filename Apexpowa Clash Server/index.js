console.clear()
process.chdir(__dirname) // every Gamefiles / Database path is relative to the server folder

const net = require('net')
const { execSync } = require('child_process')
const os = require('os')
const MessageFactory = require('./Protocol/MessageFactory')
const server = new net.Server()
const Messages = new MessageFactory()
const config = require('./config.json')
const PORT = config.Server.Port

const Crypto = require("./Crypto")
const Proxy = require('./Core/Proxy')

let mongooseInstance = require('./Database/mongoose')
mongooseInstance = new mongooseInstance()

const PlayerManager = require('./Core/PlayerManager')

server.on('connection', async (client) => {
  PlayerManager.add(client)
  
  client.setNoDelay(true)
  // Only packet reads are shown: "Gotcha <id> (<Name>) packet!" for every packet, plus the
  // "[Alliance] ..." detail line for alliance packets. Every other client.log call in the
  // server (login, commands, disconnects, ...) is muted here, in one place.
  const SHOW_LOG = /^(Gotcha (undefined )?\d+ (\(.*?\) )?(packet|command)!|\[Alliance\]|\[Clan\]|\[Error\]|\[Logic\w*\]|\[SpeedUp\w*\]|\[Home\]|\[Login\]|\[War\w*\]|\[League\]|\[Account\]|\[Save\w*\]|Packet 24301 \(AllianceDataMessage\) was sent)/

  client.log = function (text) {
    if (!config.Server.Debug) return
    if (!SHOW_LOG.test(String(text))) return

    if (config.Server.StreamerMode) {
      return console.log(`[ACS]    ${text}`)
    } else {
      return console.log(`[${this.remoteAddress.split(':').slice(-1)}]    ${text}`)
    }
  }

  client.log('A wild connection appeared!')
  client.sentLog = [] // last packets sent to this client, filled in by ByteStream.send()
  client.crypto = new Crypto()
  client.mongoose = mongooseInstance
  
  const packets = Messages.getPackets()

  // --- receive path --------------------------------------------------------------
  // TCP is a byte stream: one 'data' chunk can hold several packets, or only part of
  // one. Packets are therefore re-assembled from a buffer using the 7-byte header
  // (u16 id, u24 length, u16 version). The RC4 stream must be advanced in arrival order,
  // so every payload is decrypted right here, synchronously; only the (async) handling is
  // queued, so a client's packets are processed strictly one after another. That also
  // stops two EndClientTurn packets from editing the same village at the same time.
  client.rxBuffer = Buffer.alloc(0)
  client.packetQueue = Promise.resolve()

  // Alliance packets: 14301-14399 (create, data, join, leave, kick, chat, search, invite, ...)
  // and 14401 (alliance ranking list), or any handler whose class name contains "Alliance".
  const isAllianceId = id => (id >= 14300 && id < 14400) || id === 14401
  const hex = buf => buf.toString('hex').replace(/(..)/g, '$1 ').trim()

  const logAlliance = (id, name, data) => {
    const fields = data === undefined
      ? '(no decoded fields)'
      : JSON.stringify(data, (k, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (v && v.type === 'Buffer' && Array.isArray(v.data)) return `<${v.data.length} bytes>`
        return v
      })
    const player = client.player ? `${client.player.highID}-${client.player.lowID} "${client.player.name}"` : 'not logged in'
    client.log(`[Alliance] ${name} (${id}) from ${player} | ${fields}`)
  }


// hex dumps (see patch_hex_dump.js)
const dumpPacket = (p, why) => {
  try {
    const dir = require('path').join('ProxyLogs', 'dumps')
    require('fs').mkdirSync(dir, { recursive: true })
    const file = require('path').join(dir, `${new Date(p.at || Date.now()).toISOString().replace(/[:.]/g, '-')}-${p.id}-${p.name}${why ? '-' + why : ''}.hex`)
    require('fs').writeFileSync(file, hex(p.payload) + '\n')
    return file
  } catch (e) { return null }
}

  // Bytes are only shown when something goes wrong.
  const logErrorBytes = (id, name, payload, reason) => {
    client.log(`[Error] ${name} (${id}) ${reason} | ${payload.length} bytes: ${hex(payload.slice(0, 128))}${payload.length > 128 ? ' ...' : ''}`)
  }

  // The client app crashing shows up on the server only as a closed connection. If that happens
  // within a few seconds of a packet the server sent, that packet is the first suspect, so it is
  // printed with its bytes (this is an error case, so bytes are shown).
  const DROP_WINDOW_MS = 4000
  let dropReported = false
  const reportDrop = hadError => {
    if (dropReported) return
    dropReported = true
    if (!config.Server.Debug) return

    const last = client.sentLog[client.sentLog.length - 1]
    if (!last) return
    const ago = Date.now() - last.at
    if (ago > DROP_WINDOW_MS) return

    const recent = client.sentLog.map(p => `${p.id} (${p.name})`).join(', ')
    if (last.id === 20132 || last.sensitive) {
      client.log(`[Account] client ${hadError ? 'connection reset' : 'closed the connection'} ${ago} ms after ${last.name} (${last.id}); account reload requested, sensitive packet body omitted`)
      return
    }
    client.log(`[Error] client ${hadError ? 'connection reset' : 'closed the connection'} ${ago} ms after the server sent ${last.id} (${last.name}). Recent packets sent: ${recent}`)
    { const files = client.sentLog.map(p => dumpPacket(p, p === last ? 'LAST' : '')).filter(Boolean); if (files.length) client.log(`[Error] full dump saved: ${files[files.length - 1]} (read it with: node Tools/hex_reader.js <file> --fields)`) }
    client.log(`[Error] ${last.name} (${last.id}) ${last.payload.length} bytes: ${hex(last.payload.slice(0, 512))}${last.payload.length > 512 ? ' ...' : ''}`)
  }
  client.on('close', reportDrop)

  const handlePacket = async (id, payload) => {
    if (packets.indexOf(String(id)) !== -1) {
      const Handler = Messages.handle(id)
      const name = Handler.name
      try {
        const packet = new Handler(payload, client)

        if (config.Server.Debug) {
          client.log(`Gotcha ${id} (${name}) packet! `)
        }

        await packet.decode()
        if (config.Server.Debug && (isAllianceId(id) || /Alliance/i.test(name))) {
          logAlliance(id, name, packet.data)
        }
        await packet.process()
      } catch (e) {
        if (config.Server.Debug) logErrorBytes(id, name, payload, `failed: ${e.message}`)
        console.log(e)
      }
    } else {
      if (id > 10099) {
        client.log(`Gotcha undefined ${id} packet!`)
        // Unknown packet = error case: show its bytes so a handler can be written for it
        if (config.Server.Debug) logErrorBytes(id, 'UnhandledPacket', payload, 'has no handler')
      }
    }
  }

  client.on('data', (chunk) => {
    client.rxBuffer = Buffer.concat([client.rxBuffer, chunk])

    while (client.rxBuffer.length >= 7) {
      const len = client.rxBuffer.readUIntBE(2, 3)
      if (client.rxBuffer.length < 7 + len) break // wait for the rest of this packet

      const id = client.rxBuffer.readUInt16BE(0)
      const encrypted = client.rxBuffer.slice(7, 7 + len)
      client.rxBuffer = client.rxBuffer.slice(7 + len)

      const payload = client.crypto.decrypt(encrypted)
      client.packetQueue = client.packetQueue.then(() => handlePacket(id, payload))
    }
  })

  client.on('end', async () => {
    PlayerManager.remove(client)
    return client.log('Client disconnected.')
  })

  client.on('error', async error => {
    try {
      PlayerManager.remove(client)
      client.log('A wild error!')
      console.log(error)
      client.destroy()
    } catch (e) { }
  })
})

// https://patorjk.com/software/taag/#p=display&f=Bloody&t=ACS&x=none&v=4&h=4&w=80&we=false
console.log(`
 ▄▄▄       ▄████▄    ██████ 
▒████▄    ▒██▀ ▀█  ▒██    ▒ 
▒██  ▀█▄  ▒▓█    ▄ ░ ▓██▄   
░██▄▄▄▄██ ▒▓▓▄ ▄██▒  ▒   ██▒
 ▓█   ▓██▒▒ ▓███▀ ░▒██████▒▒
 ▒▒   ▓▒█░░ ░▒ ▒  ░▒ ▒▓▒ ▒ ░
  ▒   ▒▒ ░  ░  ▒   ░ ░▒  ░ ░
  ░   ▒   ░        ░  ░  ░  
      ░  ░░ ░            ░  
          ░                 
`)
console.log()
console.log(`ACS ${config.Server.Versions} is now starting...`)
mongooseInstance.connect(isSuccess => {
  if (isSuccess) {
    server.once('listening', () => {
        console.log(`Gateway started on port ${PORT}!`)
        console.log(`Server started successfully, Let's play Clash of Clans!`)
    })
    server.listen(PORT)
  }
  else {
    console.log("[SERVER]    Server didn't start because of a database problem.")
  }
})

// Optional logging proxy (see config.json -> Proxy)
if (config.Proxy && config.Proxy.Enabled) {
  new Proxy(config.Proxy, Messages, config.Server.RC4Key).start()
}

process.on("uncaughtException", e => console.log(e))

process.on("unhandledRejection", e => console.log(e))
