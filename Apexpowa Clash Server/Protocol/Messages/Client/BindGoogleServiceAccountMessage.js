const PiranhaMessage = require("../../PiranhaMessage")
const GoogleServiceAccountBoundMessage = require("../Server/GoogleServiceAccountBoundMessage")

class BindGoogleServiceAccountMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14262
    this.version = 1
  }

  // The request payload layout is not documented in the protocol files,
  // so it is not decoded. The account is not actually linked to Google.
  async decode () {}

  async process () {
    await new GoogleServiceAccountBoundMessage(this.client).send()
  }
}

module.exports = BindGoogleServiceAccountMessage
