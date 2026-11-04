const PiranhaMessage = require('../../PiranhaMessage')

// 24103 AttackHomeFailed (decoded from libg.so, the handler shows the text for the code):
//   INT code, INT (0)
// Codes: 1 opponent online, 2 under attack, 3 same clan, 4 shield, 5 level gap, 6 newbie,
//        7 no matches found, 8 not enough resources (the search costs gold), 10 cooldown after maintenance,
//        11 attacks disabled, 12 personal break, 16 guard.
class AttackHomeFailedMessage extends PiranhaMessage {
  constructor (client, code = 7) {
    super()
    this.id = 24103
    this.client = client
    this.version = 1
    this.code = code
  }

  async encode () {
    this.writeInt(this.code)
    this.writeInt(0)
  }
}

module.exports = AttackHomeFailedMessage
