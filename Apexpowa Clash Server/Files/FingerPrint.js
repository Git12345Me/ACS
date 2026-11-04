const fs = require('fs')
const path = require('path')

class GameFile {
  constructor (file = '', sha = '') {
    this.file = file
    this.sha = sha
  }

  load (jsonObject) {
    this.sha = jsonObject.sha
    this.file = jsonObject.file
    return this
  }

  saveToJson () {
    return {
      sha: this.sha,
      file: this.file
    }
  }
}

class FingerPrint {
  constructor (fingerprintPath = path.join(__dirname, '..', 'Gamefiles', 'fingerprint.json')) {
    this.files = []
    this.sha = null
    this.version = null

    if (fs.existsSync(fingerprintPath)) {
      const jsonString = fs.readFileSync(fingerprintPath, 'utf8')
      this.loadFromJson(jsonString)
    } else {
      console.log(
        '[SERVER]    LoadFingerPrint: error! tried to load FingerPrint without file, ' +
        'run gen_patch first'
      )
    }
  }

  loadFromJson (jsonString) {
    const jsonObject = JSON.parse(jsonString)
    const jsonFilesArray = Array.isArray(jsonObject.files)
      ? jsonObject.files
      : []

    this.files = jsonFilesArray.map(jsonFile => new GameFile().load(jsonFile))
    this.sha = jsonObject.sha
    this.version = jsonObject.version
    return this
  }

  saveToJson () {
    const jsonData = {
      files: this.files.map(file => file.saveToJson()),
      sha: this.sha,
      version: this.version
    }

    // Match JsonConvert.SerializeObject(jsonData).Replace("/", @"\/").
    return JSON.stringify(jsonData).replace(/\//g, '\\/')
  }
}

FingerPrint.GameFile = GameFile
module.exports = FingerPrint