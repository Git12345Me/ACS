const mysql = require('mysql2/promise') // direct MySQL / MariaDB driver (XAMPP), works on Node 16+
const crypto = require('crypto')
const config = require('../config.json')
const LoginFailedMessage = require('../Protocol/Messages/Server/LoginFailedMessage')

/*
 * MySQL-backed (XAMPP MySQL / MariaDB) replacement for the old Mongoose database facade.
 *
 * The rest of the server still calls this file and uses the existing
 * client.mongoose property. The property name is kept for compatibility,
 * but no MongoDB or Mongoose code is used here.
 */
module.exports = class Database {
    constructor() {
        this.pool = null

        // Write-behind save queue. savePlayer() rewrites ~36 columns including the
        // whole village LONGTEXT, and every command used to await its own write
        // (several per turn), which made the game feel slow. player.save() now just
        // marks the player dirty and returns immediately; dirty players are written
        // once, a moment later, with their latest state. Everything is flushed on
        // shutdown.
        this.dirtyPlayers = new Map()
        this.flushTimer = null
        this.flushing = null
        this.saveDelayMs = 300
        this.flushConcurrency = Number((config.Database || {}).FlushConcurrency || 8)
        this.listCache = new Map() // short-lived cache for leaderboards

        const flushAndExit = () => {
            this.flushPlayers().finally(() => process.exit(0))
        }
        process.once('SIGINT', flushAndExit)
        process.once('SIGTERM', flushAndExit)
    }

    queuePlayerSave(player) {
        this.dirtyPlayers.set(`${player.highID}:${player.lowID}`, player)
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null
                this.flushPlayers()
            }, this.saveDelayMs)
        }
        return Promise.resolve()
    }

    flushPlayers() {
        // Serialise flushes; anything queued meanwhile is picked up by the next one.
        const run = async () => {
            if (this.flushTimer) {
                clearTimeout(this.flushTimer)
                this.flushTimer = null
            }
            while (this.dirtyPlayers.size > 0 && this.pool) {
                const batch = [...this.dirtyPlayers.values()]
                this.dirtyPlayers.clear()
                // Different players are different rows, so several can be written at once
                // (bounded, so the pool is never starved for the game's own reads).
                const workers = Array.from({ length: Math.min(this.flushConcurrency, batch.length) }, async () => {
                    while (batch.length > 0) {
                        const player = batch.pop()
                        try {
                            await this.savePlayer(player)
                        } catch (error) {
                            console.log('[DATABASE] Failed to save player:', error)
                        }
                    }
                })
                await Promise.all(workers)
            }
        }
        this.flushing = (this.flushing || Promise.resolve()).then(run, run)
        return this.flushing
    }

    getConnectionConfig() {
        const database = config.Database || {}

        return {
            host: database.Host || '127.0.0.1',
            port: Number(database.Port || 3306),
            user: database.User || 'root',
            password: database.Password || '',
            database: database.Name || 'MagicDatabase',
            charset: 'utf8mb4',
            connectionLimit: Number(database.ConnectionLimit || 40),
            waitForConnections: true,
            queueLimit: 0,
            connectTimeout: Number(database.AcquireTimeout || 20000),
            idleTimeout: 600000,
            maxIdle: Number(database.MinimumIdle || 5),
            enableKeepAlive: true,
            // one statement per round trip; BIGINT / COUNT(*) come back as plain numbers (strings only when beyond 2^53)
            multipleStatements: false,
            supportBigNumbers: true,
            bigNumberStrings: false,
            dateStrings: false
        }
    }

    async connect(isSuccess) {
        try {
            const connectionConfig = this.getConnectionConfig()
            const { database, ...serverConfig } = connectionConfig
            const { connectionLimit, waitForConnections, queueLimit, idleTimeout, maxIdle, ...single } = serverConfig
            const bootstrapConnection = await mysql.createConnection(single)

            await bootstrapConnection.query(
                `CREATE DATABASE IF NOT EXISTS \`${escapeIdentifier(database)}\``
            )
            await bootstrapConnection.end()

            this.pool = mysql.createPool(connectionConfig)
            await this.pool.query('SELECT 1') // fail now, with a clear message, if MySQL is not reachable
            await this.ensureSchema()

            if (typeof isSuccess === 'function') {
                isSuccess(true)
            }
        } catch (error) {
            console.log(`[DATABASE] MySQL connection failed (${error.code || error.message}). Start MySQL in the XAMPP Control Panel and check config.json -> Database (Host, Port, User, Password).`)
            if (error.code === 'ER_ACCESS_DENIED_ERROR') console.log('[DATABASE] Wrong user/password. XAMPP default: User "root", Password "" (empty).')
            if (error.code === 'ECONNREFUSED') console.log('[DATABASE] Nothing is listening on that host/port: MySQL is not running.')
            if (typeof isSuccess === 'function') {
                isSuccess(false)
            }
        }
    }

    async disconnect() {
        await this.flushPlayers()
        if (!this.pool) return

        try {
            await this.pool.end()
            console.log('Successfully disconnected from MySQL')
        } catch (error) {
            console.log('An error occurred disconnecting from MySQL:', error)
        } finally {
            this.pool = null
        }
    }

    async query(sql, values = []) {
        if (!this.pool) {
            throw new Error('MySQL connection has not been initialized.')
        }

        // mysql2 answers [rows, fields]; the rest of the server expects the rows (SELECT) or the result header (INSERT / UPDATE).
        const [result] = await this.pool.query(sql, values)
        return result
    }

    async ensureSchema() {
        const statements = [
            `
            CREATE TABLE IF NOT EXISTS \`players\` (
                \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                \`highID\` INT NOT NULL DEFAULT 0,
                \`lowID\` INT NOT NULL,
                \`token\` VARCHAR(190) NOT NULL,
                \`name\` VARCHAR(255) NOT NULL DEFAULT 'You',
                \`village\` LONGTEXT NOT NULL,
                \`nameChangesCount\` INT NOT NULL DEFAULT 0,
                \`facebookID\` VARCHAR(255) NOT NULL DEFAULT '',
                \`trophies\` INT NOT NULL DEFAULT 0,
                \`highestTrophies\` INT NOT NULL DEFAULT 0,
                \`shieldDurationSeconds\` INT NOT NULL DEFAULT 0,
                \`guardDurationSeconds\` INT NOT NULL DEFAULT 0,
                \`personalDurationSeconds\` INT NOT NULL DEFAULT 0,
                \`attackRating\` INT NOT NULL DEFAULT 0,
                \`attackKFactor\` INT NOT NULL DEFAULT 0,
                \`cumulativePurchasedDiamonds\` INT NOT NULL DEFAULT 0,
                \`attackWinCount\` INT NOT NULL DEFAULT 0,
                \`attackLoseCount\` INT NOT NULL DEFAULT 0,
                \`defendWinCount\` INT NOT NULL DEFAULT 0,
                \`defendLoseCount\` INT NOT NULL DEFAULT 0,
                \`allianceCastleGold\` INT NOT NULL DEFAULT 0,
                \`allianceCastleMana\` INT NOT NULL DEFAULT 0,
                \`allianceCastleDarkMana\` INT NOT NULL DEFAULT 0,
                \`league\` INT NOT NULL DEFAULT 0,
                \`level\` INT NOT NULL DEFAULT 1,
                \`xpPoints\` INT NOT NULL DEFAULT 0,
                \`gold\` BIGINT NOT NULL DEFAULT 0,
                \`mana\` BIGINT NOT NULL DEFAULT 0,
                \`darkMana\` BIGINT NOT NULL DEFAULT 0,
                \`diamonds\` BIGINT NOT NULL DEFAULT 0,
                \`victories\` INT NOT NULL DEFAULT 0,
                \`tutorialSteps\` INT NOT NULL DEFAULT 0,
                \`heroes\` INT NOT NULL DEFAULT 0,
                \`inClan\` TINYINT NOT NULL DEFAULT 0,
                \`ClanHighID\` INT NOT NULL DEFAULT 0,
                \`ClanLowID\` INT NOT NULL DEFAULT 1,
                \`ClanRole\` INT NOT NULL DEFAULT 0,
                \`army\` LONGTEXT NOT NULL,
                \`spells\` LONGTEXT NOT NULL,
                \`achievements\` LONGTEXT NULL,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`uq_players_identity\` (\`highID\`, \`lowID\`),
                UNIQUE KEY \`uq_players_token\` (\`token\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `,
            `
            CREATE TABLE IF NOT EXISTS \`clans\` (
                \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                \`highID\` INT NOT NULL DEFAULT 0,
                \`lowID\` INT NOT NULL,
                \`name\` VARCHAR(255) NOT NULL,
                \`description\` LONGTEXT NOT NULL,
                \`trophies\` INT NOT NULL DEFAULT 0,
                \`requiredTrophies\` INT NOT NULL DEFAULT 0,
                \`badge\` INT NOT NULL DEFAULT 13000000,
                \`avatarID\` INT NOT NULL DEFAULT 0,
                \`type\` INT NOT NULL DEFAULT 0,
                \`location\` INT NOT NULL DEFAULT 0,
                \`warFrequency\` INT NOT NULL DEFAULT 0,
                \`origin\` INT NOT NULL DEFAULT 0,
                \`members\` LONGTEXT NOT NULL,
                \`messages\` LONGTEXT NOT NULL,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`uq_clans_identity\` (\`highID\`, \`lowID\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `,
            `
            CREATE TABLE IF NOT EXISTS \`main_accounts\` (
                \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                \`username\` VARCHAR(32) NOT NULL,
                \`passwordHash\` VARCHAR(255) NOT NULL,
                \`createdAt\` BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`uq_main_username\` (\`username\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `,
            `
            CREATE TABLE IF NOT EXISTS \`main_villages\` (
                \`mainID\` INT UNSIGNED NOT NULL,
                \`highID\` INT NOT NULL DEFAULT 0,
                \`lowID\` INT NOT NULL,
                \`position\` INT NOT NULL DEFAULT 0,
                PRIMARY KEY (\`highID\`, \`lowID\`),
                KEY \`idx_main_villages_main\` (\`mainID\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `,
            `
            CREATE TABLE IF NOT EXISTS \`village_passwords\` (
                \`highID\` INT NOT NULL DEFAULT 0,
                \`lowID\` INT NOT NULL,
                \`passwordHash\` VARCHAR(255) NOT NULL,
                PRIMARY KEY (\`highID\`, \`lowID\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `,
            `
            CREATE TABLE IF NOT EXISTS \`device_accounts\` (
                \`deviceKey\` VARCHAR(64) NOT NULL,
                \`highID\` INT NOT NULL DEFAULT 0,
                \`lowID\` INT NOT NULL,
                \`updatedAt\` BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (\`deviceKey\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `,
            `
            CREATE TABLE IF NOT EXISTS \`redeem_claims\` (
                \`code\` VARCHAR(64) NOT NULL,
                \`highID\` INT NOT NULL DEFAULT 0,
                \`lowID\` INT NOT NULL,
                \`claimedAt\` BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (\`code\`, \`highID\`, \`lowID\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `
        ]

        for (const statement of statements) {
            await this.query(statement)
        }

        // Older versions created players.token as VARCHAR(255). With utf8mb4 (4 bytes per character) its UNIQUE
        // index is 1020 bytes, above the 767 byte limit of old MySQL / MariaDB (error #1071). Tokens are 28 hex
        // characters, so a table that already exists is shrunk to VARCHAR(190) (760 bytes) as well.
        try {
            await this.query('ALTER TABLE `players` MODIFY `token` VARCHAR(190) NOT NULL')
        } catch (error) {
            console.log(`[DATABASE] could not shrink players.token (${error.code || error.message}); ignoring`)
        }

        // CREATE TABLE IF NOT EXISTS does not update an already-existing
        // table. Keep existing MySQL databases compatible with the current
        // player and clan models by applying additive migrations during
        // startup.
        await this.ensureColumns('players', {
            nameChangesCount: 'INT NOT NULL DEFAULT 0',
            facebookID: "VARCHAR(255) NOT NULL DEFAULT ''",
            trophies: 'INT NOT NULL DEFAULT 0',
            highestTrophies: 'INT NOT NULL DEFAULT 0',
            shieldDurationSeconds: 'INT NOT NULL DEFAULT 0',
            guardDurationSeconds: 'INT NOT NULL DEFAULT 0',
            personalDurationSeconds: 'INT NOT NULL DEFAULT 0',
            attackRating: 'INT NOT NULL DEFAULT 0',
            attackKFactor: 'INT NOT NULL DEFAULT 0',
            cumulativePurchasedDiamonds: 'INT NOT NULL DEFAULT 0',
            attackWinCount: 'INT NOT NULL DEFAULT 0',
            attackLoseCount: 'INT NOT NULL DEFAULT 0',
            defendWinCount: 'INT NOT NULL DEFAULT 0',
            defendLoseCount: 'INT NOT NULL DEFAULT 0',
            allianceCastleGold: 'INT NOT NULL DEFAULT 0',
            allianceCastleMana: 'INT NOT NULL DEFAULT 0',
            allianceCastleDarkMana: 'INT NOT NULL DEFAULT 0',
            league: 'INT NOT NULL DEFAULT 0',
            level: 'INT NOT NULL DEFAULT 0',
            xpPoints: 'INT NOT NULL DEFAULT 0',
            gold: 'BIGINT NOT NULL DEFAULT 0',
            mana: 'BIGINT NOT NULL DEFAULT 0',
            darkMana: 'BIGINT NOT NULL DEFAULT 0',
            diamonds: 'BIGINT NOT NULL DEFAULT 0',
            victories: 'INT NOT NULL DEFAULT 0',
            tutorialSteps: 'INT NOT NULL DEFAULT 0',
            heroes: 'INT NOT NULL DEFAULT 0',
            inClan: 'TINYINT NOT NULL DEFAULT 0',
            ClanHighID: 'INT NOT NULL DEFAULT 0',
            ClanLowID: 'INT NOT NULL DEFAULT 1',
            ClanRole: 'INT NOT NULL DEFAULT 0',
            village: 'LONGTEXT NULL',
            army: 'LONGTEXT NULL',
            spells: 'LONGTEXT NULL',
            achievements: 'LONGTEXT NULL'
        })

        await this.ensureColumns('clans', {
            description: 'LONGTEXT NULL',
            trophies: 'INT NOT NULL DEFAULT 0',
            requiredTrophies: 'INT NOT NULL DEFAULT 0',
            badge: 'INT NOT NULL DEFAULT 13000000',
            avatarID: 'INT NOT NULL DEFAULT 0',
            type: 'INT NOT NULL DEFAULT 0',
            location: 'INT NOT NULL DEFAULT 0',
            warFrequency: 'INT NOT NULL DEFAULT 0',
            origin: 'INT NOT NULL DEFAULT 0',
            members: 'LONGTEXT NULL',
            messages: 'LONGTEXT NULL'
        })

        // Indexes for 50,000+ accounts: without them these queries scan (and sort) the whole table.
        await this.ensureIndex('players', 'idx_players_lowid', ['lowID']) // MAX(lowID) for new accounts, random opponent
        await this.ensureIndex('players', 'idx_players_trophies', ['trophies']) // leaderboards
        await this.ensureIndex('players', 'idx_players_clan', ['inClan', 'ClanHighID', 'ClanLowID']) // clan member lists
        await this.ensureIndex('clans', 'idx_clans_trophies', ['trophies']) // clan leaderboards / search order
        await this.ensureIndex('clans', 'idx_clans_type_trophies', ['type', 'trophies']) // join list

        // Older ACS schemas contain required fields such as `clan` and
        // `createdAt` that are no longer written by the current model. Keep
        // those legacy fields from blocking new-player inserts.
        await this.relaxUnexpectedRequiredColumns('players', [
            'highID',
            'lowID',
            'token',
            'name',
            'village',
            'trophies',
            'highestTrophies',
            'level',
            'gold',
            'mana',
            'darkMana',
            'diamonds',
            'army',
            'spells'
        ])

        await this.relaxUnexpectedRequiredColumns('clans', [
            'highID',
            'lowID',
            'name',
            'description',
            'badge',
            'type',
            'requiredTrophies',
            'location',
            'warFrequency',
            'origin',
            'trophies',
            'members',
            'messages'
        ])
    }

    async ensureIndex(tableName, indexName, columns) {
        try {
            const rows = await this.query(
                `SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
                [tableName, indexName]
            )
            if (rows.length > 0) return
            const cols = columns.map(c => `\`${escapeIdentifier(c)}\``).join(', ')
            await this.query(`ALTER TABLE \`${escapeIdentifier(tableName)}\` ADD INDEX \`${escapeIdentifier(indexName)}\` (${cols})`)
            console.log(`[DATABASE] added index ${indexName} on ${tableName}`)
        } catch (error) {
            console.log(`[DATABASE] could not add index ${indexName}:`, error.message)
        }
    }

    async ensureColumns(tableName, columns) {
        const rows = await this.query(
            `
            SELECT \`COLUMN_NAME\`
            FROM \`information_schema\`.\`COLUMNS\`
            WHERE \`TABLE_SCHEMA\` = DATABASE()
              AND \`TABLE_NAME\` = ?
            `,
            [tableName]
        )
        const existingColumns = new Set(rows.map(row => row.COLUMN_NAME))

        for (const [columnName, definition] of Object.entries(columns)) {
            if (existingColumns.has(columnName)) continue

            await this.query(
                `ALTER TABLE \`${escapeIdentifier(tableName)}\` ADD COLUMN \`${escapeIdentifier(columnName)}\` ${definition}`
            )
            console.log(`[DATABASE] Added missing column ${tableName}.${columnName}`)
        }
    }

    async relaxUnexpectedRequiredColumns(tableName, allowedRequiredColumns) {
        const rows = await this.query(
            `
            SELECT
                \`COLUMN_NAME\`,
                \`COLUMN_TYPE\`,
                \`IS_NULLABLE\`,
                \`COLUMN_DEFAULT\`,
                \`EXTRA\`
            FROM \`information_schema\`.\`COLUMNS\`
            WHERE \`TABLE_SCHEMA\` = DATABASE()
              AND \`TABLE_NAME\` = ?
            `,
            [tableName]
        )
        const allowedColumns = new Set(allowedRequiredColumns)

        for (const row of rows) {
            const extra = String(row.EXTRA || '').toLowerCase()
            if (
                allowedColumns.has(row.COLUMN_NAME) ||
                row.IS_NULLABLE === 'YES' ||
                row.COLUMN_DEFAULT !== null ||
                extra.includes('auto_increment') ||
                extra.includes('generated')
            ) {
                continue
            }

            await this.query(
                `ALTER TABLE \`${escapeIdentifier(tableName)}\` MODIFY COLUMN \`${escapeIdentifier(row.COLUMN_NAME)}\` ${row.COLUMN_TYPE} NULL`
            )
            console.log(`[DATABASE] Made legacy column ${tableName}.${row.COLUMN_NAME} optional`)
        }
    }

    // A brand-new player row (used for first logins and for villages added to a main account).
    async createNewPlayer() {
        const lastRows = await this.query(
            'SELECT COALESCE(MAX(`lowID`), 0) AS `lastLowID` FROM `players`'
        )
        const lowID = Number(lastRows[0]?.lastLowID || 0) + 1
        const token = crypto.randomBytes(14).toString('hex')

        await this.query(
            `
            INSERT INTO \`players\`
            (
                \`highID\`, \`lowID\`, \`token\`, \`name\`, \`village\`,
                \`trophies\`, \`highestTrophies\`, \`level\`,
                \`gold\`, \`mana\`, \`darkMana\`, \`diamonds\`,
                \`army\`, \`spells\`
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                0,
                lowID,
                token,
                'You',
                '',
                this.playerDefault('StartingScore', 0),
                this.playerDefault('StartingScore', 0),
                this.playerDefault('StartingLevel', 1),
                this.playerDefault('StartingResources.Gold', 0),
                this.playerDefault('StartingResources.Mana', 0),
                this.playerDefault('StartingResources.DarkMana', 0),
                this.playerDefault('StartingResources.Diamonds', 0),
                '[]',
                '[]'
            ]
        )

        const rows = await this.query(
            'SELECT * FROM `players` WHERE `token` = ? LIMIT 1',
            [token]
        )
        const player = this.mapPlayer(rows[0])
        if (player) {
            player.xpPoints = this.playerDefault('StartingExperience', 0)
            await this.savePlayer(player)
        }
        return player
    }

    // ---- main accounts (username + password owning several villages, see Core/AccountCommands.js)

    hashPassword(password) {
        const salt = crypto.randomBytes(16)
        return `${salt.toString('hex')}:${crypto.scryptSync(String(password), salt, 32).toString('hex')}`
    }

    passwordMatches(password, stored) {
        const [saltHex, hashHex] = String(stored || '').split(':')
        if (!saltHex || !hashHex) return false
        const expected = Buffer.from(hashHex, 'hex')
        const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length)
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    }

    async createMainAccount(username, password) {
        try {
            const result = await this.query(
                'INSERT INTO `main_accounts` (`username`, `passwordHash`, `createdAt`) VALUES (?, ?, ?)',
                [username, this.hashPassword(password), Date.now()]
            )
            return { id: Number(result.insertId), username }
        } catch (error) {
            if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) return null // username taken
            throw error
        }
    }

    async checkMainAccount(username, password) {
        const rows = await this.query('SELECT * FROM `main_accounts` WHERE `username` = ? LIMIT 1', [username])
        if (!rows[0]) { this.hashPassword(password); return null } // same work either way
        return this.passwordMatches(password, rows[0].passwordHash) ? { id: Number(rows[0].id), username: rows[0].username } : null
    }

    async getMainAccount(id) {
        const rows = await this.query('SELECT * FROM `main_accounts` WHERE `id` = ? LIMIT 1', [id])
        return rows[0] ? { id: Number(rows[0].id), username: rows[0].username } : null
    }

    async setMainPassword(id, password) {
        await this.query('UPDATE `main_accounts` SET `passwordHash` = ? WHERE `id` = ?', [this.hashPassword(password), id])
    }

    // ---- redeem codes (Core/RedeemCodes.js): one use per village, at most maxPlayers villages per code

    async claimRedeemCode(code, highID, lowID, maxPlayers) {
        const count = async () => Number((await this.query('SELECT COUNT(*) AS `n` FROM `redeem_claims` WHERE `code` = ?', [code]))[0].n)
        if (await count() >= maxPlayers) {
            const mine = await this.query('SELECT 1 FROM `redeem_claims` WHERE `code` = ? AND `highID` = ? AND `lowID` = ? LIMIT 1', [code, highID, lowID])
            return { status: mine.length ? 'already' : 'full' }
        }
        try {
            await this.query('INSERT INTO `redeem_claims` (`code`, `highID`, `lowID`, `claimedAt`) VALUES (?, ?, ?, ?)', [code, highID, lowID, Date.now()])
        } catch (error) {
            if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) return { status: 'already' }
            throw error
        }
        // two players can pass the check above at the same moment: the one past the limit gives its claim back
        const used = await count()
        if (used > maxPlayers) {
            await this.query('DELETE FROM `redeem_claims` WHERE `code` = ? AND `highID` = ? AND `lowID` = ?', [code, highID, lowID])
            return { status: 'full' }
        }
        return { status: 'ok', used }
    }

    // ---- village passwords: the village id is the username (see Core/AccountCommands.js)

    async hasVillagePassword(highID, lowID) {
        const rows = await this.query('SELECT 1 FROM `village_passwords` WHERE `highID` = ? AND `lowID` = ? LIMIT 1', [highID, lowID])
        return rows.length > 0
    }

    async setVillagePassword(highID, lowID, password) {
        await this.query(
            'INSERT INTO `village_passwords` (`highID`, `lowID`, `passwordHash`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `passwordHash` = VALUES(`passwordHash`)',
            [highID, lowID, this.hashPassword(password)]
        )
    }

    async checkVillagePassword(highID, lowID, password) {
        const rows = await this.query('SELECT `passwordHash` FROM `village_passwords` WHERE `highID` = ? AND `lowID` = ? LIMIT 1', [highID, lowID])
        if (!rows[0]) { this.hashPassword(password); return false } // same work either way
        return this.passwordMatches(password, rows[0].passwordHash)
    }

    // The main account a village belongs to (0 = none).
    async mainAccountOf(highID, lowID) {
        const rows = await this.query('SELECT `mainID` FROM `main_villages` WHERE `highID` = ? AND `lowID` = ? LIMIT 1', [highID, lowID])
        return rows[0] ? Number(rows[0].mainID) : 0
    }

    async mainAccountVillages(mainID) {
        const rows = await this.query(
            'SELECT `highID`, `lowID` FROM `main_villages` WHERE `mainID` = ? ORDER BY `position`, `lowID`',
            [mainID]
        )
        return rows.map(r => ({ highID: Number(r.highID), lowID: Number(r.lowID) }))
    }

    async attachVillage(mainID, highID, lowID) {
        const rows = await this.query('SELECT COUNT(*) AS `n` FROM `main_villages` WHERE `mainID` = ?', [mainID])
        await this.query(
            'INSERT INTO `main_villages` (`mainID`, `highID`, `lowID`, `position`) VALUES (?, ?, ?, ?)',
            [mainID, highID, lowID, Number(rows[0].n)]
        )
    }

    async getPlayer(device, callback) {
        try {
            const user = device.userObject || {}
            const highID = Number(user.highID || 0)
            const lowID = Number(user.lowID || 0)
            const token = String(user.token || '')
            let rows = []

            // The token is not reliably returned by every supported client
            // build after a cold restart. The assigned LogicLong is the
            // durable account identity, so recover by it before creating a
            // new player.
            if (lowID > 0) {
                rows = await this.query(
                    `
                    SELECT *
                    FROM \`players\`
                    WHERE \`highID\` = ? AND \`lowID\` = ?
                    LIMIT 1
                    `,
                    [highID, lowID]
                )
            }

            // Some clients keep the token but temporarily omit the account
            // ID. Token-only recovery prevents an unnecessary new account in
            // that case.
            if (rows.length === 0 && token.length > 0) {
                rows = await this.query(
                    'SELECT * FROM `players` WHERE `token` = ? LIMIT 1',
                    [token]
                )
            }

            // Some clients send neither their saved id nor their token after a restart (every start then looked like a
            // brand-new phone and created a new account). The device ids sent at login (same on every start) are
            // remembered per account, and used only when the client itself identified nothing.
            // No device ids either (some clients / emulators send blanks): fall back to the connection's IP address.
            const ip = String((device && device.remoteAddress) || '').replace(/^::ffff:/, '')
            const deviceKey = String(user.deviceKey || '') || (ip ? `ip:${ip}` : '')
            let foundBy = rows.length ? (lowID > 0 && rows[0] && Number(rows[0].lowID) === lowID ? 'id' : 'token') : ''
            const sentNothing = lowID <= 0 && token.length === 0
            if (rows.length === 0 && sentNothing && deviceKey) {
                try {
                    const dev = await this.query('SELECT `highID`, `lowID` FROM `device_accounts` WHERE `deviceKey` = ? LIMIT 1', [deviceKey])
                    if (dev.length > 0) {
                        rows = await this.query('SELECT * FROM `players` WHERE `highID` = ? AND `lowID` = ? LIMIT 1', [dev[0].highID, dev[0].lowID])
                        if (rows.length) foundBy = 'device'
                    }
                } catch (e) {
                    console.log('[DATABASE] device lookup failed:', e.code || e.message)
                }
            }

            let player = this.mapPlayer(rows[0])
            const isNewPlayer = !player

            if (!player) player = await this.createNewPlayer()
            console.log(`[Login] ${isNewPlayer ? 'NEW account created' : 'existing account loaded (found by ' + foundBy + ')'}: ${player && player.highID}-${player && player.lowID} | client sent id=${highID}-${lowID} token=${token ? token.slice(0, 6) + '...' : '(empty)'} device=${deviceKey ? deviceKey.slice(0, 10) : '(none)'}`)

            if (player && deviceKey) {
                try {
                    await this.query(
                        'INSERT INTO `device_accounts` (`deviceKey`, `highID`, `lowID`, `updatedAt`) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `highID` = VALUES(`highID`), `lowID` = VALUES(`lowID`), `updatedAt` = VALUES(`updatedAt`)',
                        [deviceKey, player.highID, player.lowID, Date.now()]
                    )
                } catch (e) {
                    console.log('[DATABASE] could not remember the device:', e.code || e.message)
                }
            }

            callback(null, player)
        } catch (error) {
            console.log('An error occurred fetching a player from MySQL:', error)
            callback(error, null)
        }
    }

    getClan(device, callback) {
        this.getPlayerClan(device.player)
            .then(clan => callback(clan))
            .catch(error => {
                console.log('An error occurred fetching a clan from MySQL:', error)
                callback(null)
            })
    }

    async getRandomPlayer(excludeLowID, callback) {
        try {
            const rows = await this.query(
                `
                SELECT *
                FROM \`players\`
                WHERE \`lowID\` <> ?
                  AND \`id\` >= (
                      SELECT FLOOR(MIN(\`id\`) + RAND() * GREATEST(MAX(\`id\`) - MIN(\`id\`), 0)) FROM \`players\`
                  )
                ORDER BY \`id\`
                LIMIT 1
                `,
                [excludeLowID]
            )
            // (a random id instead of ORDER BY RAND(): sorting every account for each search is far too slow.)
            if (rows.length === 0) {
                const fallback = await this.query('SELECT * FROM `players` WHERE `lowID` <> ? ORDER BY `id` LIMIT 1', [excludeLowID])
                return callback(null, this.mapPlayer(fallback[0]))
            }
            callback(null, this.mapPlayer(rows[0]))
        } catch (error) {
            console.log('Error getting random player:', error)
            callback(error, null)
        }
    }

    async getSpecificPlayer(highID, lowID, callback) {
        try {
            const rows = await this.query(
                'SELECT * FROM `players` WHERE `highID` = ? AND `lowID` = ? LIMIT 1',
                [highID, lowID]
            )
            const player = this.mapPlayer(rows[0])
            callback(player ? null : 'Player not found!', player)
        } catch (error) {
            console.log('Error getting player:', error)
            callback(error, null)
        }
    }

    // Leaderboards are the same for everybody and cost a sort of the whole table: keep the rows for a few seconds.
    async cachedList(key, load, ttlMs = 15000) {
        const hit = this.listCache.get(key)
        if (hit && Date.now() - hit.at < ttlMs) return hit.rows
        const rows = await load()
        this.listCache.set(key, { at: Date.now(), rows })
        return rows
    }

    async getTopPlayers(limit = 200) {
        const safeLimit = this.safeLimit(limit)
        const rows = await this.cachedList(`players:${safeLimit}`, () => this.query(
            `SELECT * FROM \`players\` ORDER BY \`trophies\` DESC LIMIT ${safeLimit}`
        ))
        return rows.map(row => this.mapPlayer(row))
    }

    async getLocalPlayers(limit = 200) {
        return this.getTopPlayers(limit)
    }

    async getClanByID(highID, lowID) {
        const rows = await this.query(
            'SELECT * FROM `clans` WHERE `highID` = ? AND `lowID` = ? LIMIT 1',
            [highID, lowID]
        )
        return this.mapClan(rows[0])
    }

    async getPlayerClan(player) {
        if (!player || !player.clan || !player.inClan) return null
        return this.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
    }

    async getPlayerByID(highID, lowID) {
        if (highID === undefined || lowID === undefined) return null

        const rows = await this.query(
            'SELECT * FROM `players` WHERE `highID` = ? AND `lowID` = ? LIMIT 1',
            [highID, lowID]
        )
        return this.mapPlayer(rows[0])
    }

    async searchClans(nameQuery = '', limit = 20) {
        const safeLimit = this.safeLimit(limit)
        const trimmedQuery = String(nameQuery || '').trim()
        const rows = await this.query(
            `
            SELECT *
            FROM \`clans\`
            WHERE \`name\` LIKE CONCAT('%', ?, '%')
            ORDER BY \`trophies\` DESC
            LIMIT ${safeLimit}
            `,
            [trimmedQuery]
        )
        return rows.map(row => this.mapClan(row))
    }

    async getJoinableClans(limit = 20) {
        const safeLimit = this.safeLimit(limit)
        const rows = await this.query(
            `
            SELECT *
            FROM \`clans\`
            WHERE \`type\` = 0
            ORDER BY \`trophies\` DESC
            LIMIT ${safeLimit}
            `
        )
        return rows.map(row => this.mapClan(row))
    }

    async getTopClans(limit = 200) {
        const safeLimit = this.safeLimit(limit)
        const rows = await this.cachedList(`clans:${safeLimit}`, () => this.query(
            `SELECT * FROM \`clans\` ORDER BY \`trophies\` DESC LIMIT ${safeLimit}`
        ))
        return rows.map(row => this.mapClan(row))
    }

    async createClan(player, {
        name,
        description,
        badge,
        type,
        requiredTrophies,
        location,
        warFrequency = 0,
        origin = 0
    }) {
        const lastRows = await this.query(
            'SELECT COALESCE(MAX(`lowID`), 0) AS `lastLowID` FROM `clans`'
        )
        const lowID = Number(lastRows[0]?.lastLowID || 0) + 1
        const memberEntry = buildMemberEntry(player, 2)

        await this.query(
            `
            INSERT INTO \`clans\`
            (
                \`highID\`, \`lowID\`, \`name\`, \`description\`, \`badge\`,
                \`type\`, \`requiredTrophies\`, \`location\`, \`warFrequency\`,
                \`origin\`, \`trophies\`, \`members\`, \`messages\`
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                0,
                lowID,
                name,
                description || '',
                normalizeBadge(badge),
                type || 0,
                requiredTrophies || 0,
                location || 57,
                warFrequency || 0,
                origin || location || 0,
                calcClanScore([memberEntry]),
                JSON.stringify([memberEntry]),
                '[]'
            ]
        )

        player.inClan = 1
        player.clan.ClanHighID = 0
        player.clan.ClanLowID = lowID
        player.clan.ClanRole = 2
        await this.savePlayer(player)

        return this.getClanByID(0, lowID)
    }

    async joinClan(player, clan) {
        const members = Array.isArray(clan.members) ? clan.members : []

        if (members.length >= 50) throw new Error('Clan is full.')
        if (clan.type === 2) throw new Error('Clan is closed.')
        if (player.trophies < (clan.requiredTrophies || 0)) {
            throw new Error(`Need ${clan.requiredTrophies || 0} trophies to join.`)
        }

        members.push(buildMemberEntry(player, 1))
        clan.members = members
        clan.trophies = calcClanScore(members)
        await this.saveClan(clan)

        player.inClan = 1
        player.clan.ClanHighID = clan.highID
        player.clan.ClanLowID = clan.lowID
        player.clan.ClanRole = 1
        await this.savePlayer(player)

        return this.getClanByID(clan.highID, clan.lowID)
    }

    async leaveClan(player) {
        const clan = await this.getClanByID(
            player.clan.ClanHighID,
            player.clan.ClanLowID
        )
        if (!clan) return

        const wasLeader = player.clan.ClanRole === 2
        clan.members = clan.members.filter(member =>
            !(member.highID === player.highID && member.lowID === player.lowID)
        )

        if (clan.members.length === 0) {
            await this.query(
                'DELETE FROM `clans` WHERE `highID` = ? AND `lowID` = ?',
                [clan.highID, clan.lowID]
            )
        } else {
            if (wasLeader) {
                // Preserve the clan's leadership by promoting an existing co-leader first.
                // If legacy data has no co-leader, fall back to the first remaining member.
                const nextLeader = clan.members.find(member => member.role === 4) || clan.members[0]
                nextLeader.role = 2
                await this.query(
                    `
                    UPDATE \`players\`
                    SET \`ClanRole\` = 2
                    WHERE \`highID\` = ? AND \`lowID\` = ?
                    `,
                    [nextLeader.highID, nextLeader.lowID]
                )
            }

            clan.trophies = calcClanScore(clan.members)
            await this.saveClan(clan)
        }

        player.inClan = 0
        player.clan.ClanHighID = 0
        player.clan.ClanLowID = 1
        player.clan.ClanRole = 0
        await this.savePlayer(player)
    }

    async updateClanSettings(clan, {
        description,
        badge,
        type,
        requiredTrophies,
        location
    }) {
        if (description !== undefined) clan.description = description
        if (badge !== undefined) clan.badge = badge
        if (type !== undefined) clan.type = type
        if (requiredTrophies !== undefined) clan.requiredTrophies = requiredTrophies
        if (location !== undefined) clan.location = location

        await this.saveClan(clan)
        return this.getClanByID(clan.highID, clan.lowID)
    }

    async promoteMember(clan, memberHighID, memberLowID, newRole) {
        const member = clan.members.find(entry =>
            entry.highID === memberHighID && entry.lowID === memberLowID
        )
        if (!member) throw new Error('Member not found.')

        member.role = newRole
        await this.saveClan(clan)
        await this.query(
            `
            UPDATE \`players\`
            SET \`ClanRole\` = ?
            WHERE \`highID\` = ? AND \`lowID\` = ?
            `,
            [newRole, memberHighID, memberLowID]
        )

        return member
    }

    async kickMember(clan, memberHighID, memberLowID) {
        const memberIndex = clan.members.findIndex(entry =>
            entry.highID === memberHighID && entry.lowID === memberLowID
        )
        if (memberIndex === -1) throw new Error('Member not found.')

        const kicked = clan.members[memberIndex]
        clan.members.splice(memberIndex, 1)

        if (clan.members.length === 0) {
            await this.query(
                'DELETE FROM `clans` WHERE `highID` = ? AND `lowID` = ?',
                [clan.highID, clan.lowID]
            )
        } else {
            clan.trophies = calcClanScore(clan.members)
            await this.saveClan(clan)
        }

        await this.query(
            `
            UPDATE \`players\`
            SET \`inClan\` = 0, \`ClanHighID\` = 0, \`ClanLowID\` = 1, \`ClanRole\` = 0
            WHERE \`highID\` = ? AND \`lowID\` = ?
            `,
            [memberHighID, memberLowID]
        )

        return kicked
    }

    async getClanMembers(highID, lowID) {
        const clan = await this.getClanByID(highID, lowID)
        return clan ? clan.members : []
    }

    async getClanLeaderboardMembers(highID, lowID, savedMembers = []) {
        const rows = await this.query(
            `
            SELECT *
            FROM \`players\`
            WHERE \`inClan\` = 1 AND \`ClanHighID\` = ? AND \`ClanLowID\` = ?
            `,
            [highID, lowID]
        )

        const savedRoster = Array.isArray(savedMembers) ? savedMembers : []

        // Older data may have the roster saved on the clan but no matching player rows.
        if (rows.length === 0) return savedRoster

        const savedById = new Map(
            savedRoster.map(member => [
                `${Number(member.highID)}:${Number(member.lowID)}`,
                member
            ])
        )

        const liveMembers = rows.map(row => {
            const player = this.mapPlayer(row)
            const saved = savedById.get(`${player.highID}:${player.lowID}`) || {}
            return {
                ...saved,
                highID: player.highID,
                lowID: player.lowID,
                name: player.name || saved.name || '',
                role: player.clan.ClanRole || saved.role || 1,
                level: player.level || 1,
                league: player.league || 0,
                trophies: player.trophies || 0
            }
        })

        // The clan's saved roster is authoritative for membership. A partial players
        // table must not silently remove members from the clan screen.
        const liveIds = new Set(liveMembers.map(member =>
            `${Number(member.highID)}:${Number(member.lowID)}`
        ))
        for (const saved of savedRoster) {
            const id = `${Number(saved.highID)}:${Number(saved.lowID)}`
            if (!liveIds.has(id)) liveMembers.push(saved)
        }

        return liveMembers
    }

    async updateMemberStats(memberHighID, memberLowID, stats) {
        // A player is in one clan at most: look that clan up instead of loading and rescanning every clan.
        const own = await this.query(
            'SELECT `ClanHighID`, `ClanLowID` FROM `players` WHERE `highID` = ? AND `lowID` = ? AND `inClan` = 1 LIMIT 1',
            [memberHighID, memberLowID]
        )
        if (own.length === 0) return
        const rows = await this.query(
            'SELECT * FROM `clans` WHERE `highID` = ? AND `lowID` = ? LIMIT 1',
            [own[0].ClanHighID, own[0].ClanLowID]
        )

        for (const row of rows) {
            const clan = this.mapClan(row)
            const member = clan.members.find(entry =>
                entry.highID === memberHighID && entry.lowID === memberLowID
            )

            if (!member) continue

            if (stats.trophies !== undefined) member.trophies = stats.trophies
            if (stats.level !== undefined) member.level = stats.level
            if (stats.league !== undefined) member.league = stats.league
            if (stats.name !== undefined) member.name = stats.name

            clan.trophies = calcClanScore(clan.members)
            await this.saveClan(clan)
        }
    }

    async savePlayer(player) {
        await this.query(
            `
            UPDATE \`players\`
            SET
                \`name\` = ?,
                \`village\` = ?,
                \`nameChangesCount\` = ?,
                \`facebookID\` = ?,
                \`trophies\` = ?,
                \`highestTrophies\` = ?,
                \`shieldDurationSeconds\` = ?,
                \`guardDurationSeconds\` = ?,
                \`personalDurationSeconds\` = ?,
                \`attackRating\` = ?,
                \`attackKFactor\` = ?,
                \`cumulativePurchasedDiamonds\` = ?,
                \`attackWinCount\` = ?,
                \`attackLoseCount\` = ?,
                \`defendWinCount\` = ?,
                \`defendLoseCount\` = ?,
                \`allianceCastleGold\` = ?,
                \`allianceCastleMana\` = ?,
                \`allianceCastleDarkMana\` = ?,
                \`league\` = ?,
                \`level\` = ?,
                \`xpPoints\` = ?,
                \`gold\` = ?,
                \`mana\` = ?,
                \`darkMana\` = ?,
                \`diamonds\` = ?,
                \`victories\` = ?,
                \`tutorialSteps\` = ?,
                \`heroes\` = ?,
                \`inClan\` = ?,
                \`ClanHighID\` = ?,
                \`ClanLowID\` = ?,
                \`ClanRole\` = ?,
                \`army\` = ?,
                \`spells\` = ?,
                \`achievements\` = ?
            WHERE \`highID\` = ? AND \`lowID\` = ?
            `,
            [
                player.name || 'You',
                player.village || '',
                player.nameChangesCount || 0,
                player.facebookID || '',
                player.trophies || 0,
                player.highestTrophies || 0,
                player.shieldDurationSeconds || 0,
                player.guardDurationSeconds || 0,
                player.personalDurationSeconds || 0,
                player.attackRating || 0,
                player.attackKFactor || 0,
                player.cumulativePurchasedDiamonds || 0,
                player.attackWinCount || 0,
                player.attackLoseCount || 0,
                player.defendWinCount || 0,
                player.defendLoseCount || 0,
                player.allianceCastleGold || 0,
                player.allianceCastleMana || 0,
                player.allianceCastleDarkMana || 0,
                player.league || 0,
                player.level || 1,
                player.xpPoints || 0,
                player.gold || 0,
                player.mana || 0,
                player.darkMana || 0,
                player.diamonds || 0,
                player.victories || 0,
                player.tutorialSteps || 0,
                player.heroes || 0,
                player.inClan || 0,
                player.clan?.ClanHighID || 0,
                player.clan?.ClanLowID || 1,
                player.clan?.ClanRole || 0,
                stringifyJson(player.army),
                stringifyJson(player.spells),
                stringifyJson(player.achievements),
                player.highID,
                player.lowID
            ]
        )
    }

    async saveClan(clan) {
        await this.query(
            `
            UPDATE \`clans\`
            SET
                \`name\` = ?,
                \`description\` = ?,
                \`trophies\` = ?,
                \`requiredTrophies\` = ?,
                \`badge\` = ?,
                \`avatarID\` = ?,
                \`type\` = ?,
                \`location\` = ?,
                \`warFrequency\` = ?,
                \`origin\` = ?,
                \`members\` = ?,
                \`messages\` = ?
            WHERE \`highID\` = ? AND \`lowID\` = ?
            `,
            [
                clan.name || '',
                clan.description || '',
                clan.trophies || 0,
                clan.requiredTrophies || 0,
                clan.badge || 0,
                clan.avatarID || 0,
                clan.type || 0,
                clan.location || 0,
                clan.warFrequency || 0,
                clan.origin || 0,
                stringifyJson(clan.members),
                stringifyJson(clan.messages),
                clan.highID,
                clan.lowID
            ]
        )
    }

    mapPlayer(row) {
        if (!row) return null

        const player = {
            highID: Number(row.highID),
            lowID: Number(row.lowID),
            token: row.token,
            name: row.name,
            village: row.village,
            nameChangesCount: Number(row.nameChangesCount || 0),
            facebookID: row.facebookID,
            trophies: Number(row.trophies || 0),
            highestTrophies: Number(row.highestTrophies || 0),
            shieldDurationSeconds: Number(row.shieldDurationSeconds || 0),
            guardDurationSeconds: Number(row.guardDurationSeconds || 0),
            personalDurationSeconds: Number(row.personalDurationSeconds || 0),
            attackRating: Number(row.attackRating || 0),
            attackKFactor: Number(row.attackKFactor || 0),
            cumulativePurchasedDiamonds: Number(row.cumulativePurchasedDiamonds || 0),
            attackWinCount: Number(row.attackWinCount || 0),
            attackLoseCount: Number(row.attackLoseCount || 0),
            defendWinCount: Number(row.defendWinCount || 0),
            defendLoseCount: Number(row.defendLoseCount || 0),
            allianceCastleGold: Number(row.allianceCastleGold || 0),
            allianceCastleMana: Number(row.allianceCastleMana || 0),
            allianceCastleDarkMana: Number(row.allianceCastleDarkMana || 0),
            league: Number(row.league || 0),
            level: Number(row.level || 1),
            xpPoints: Number(row.xpPoints || 0),
            gold: Number(row.gold || 0),
            mana: Number(row.mana || 0),
            darkMana: Number(row.darkMana || 0),
            diamonds: Number(row.diamonds || 0),
            victories: Number(row.victories || 0),
            tutorialSteps: Number(row.tutorialSteps || 0),
            heroes: Number(row.heroes || 0),
            inClan: Number(row.inClan || 0),
            clan: {
                ClanHighID: Number(row.ClanHighID || 0),
                ClanLowID: Number(row.ClanLowID || 1),
                ClanRole: Number(row.ClanRole || 0)
            },
            army: parseJson(row.army, []),
            spells: parseJson(row.spells, []),
            achievements: parseJson(row.achievements, [])
        }

        player.markModified = () => {}
        player.save = () => this.queuePlayerSave(player)
        return player
    }

    mapClan(row) {
        if (!row) return null

        const clan = {
            highID: Number(row.highID),
            lowID: Number(row.lowID),
            name: row.name || '',
            description: row.description || '',
            trophies: Number(row.trophies || 0),
            requiredTrophies: Number(row.requiredTrophies || 0),
            badge: normalizeBadge(row.badge),
            avatarID: Number(row.avatarID || 0),
            type: Number(row.type || 0),
            location: Number(row.location || 0),
            warFrequency: Number(row.warFrequency || 0),
            origin: Number(row.origin || 0),
            members: parseJson(row.members, []),
            messages: parseJson(row.messages, [])
        }

        clan.markModified = () => {}
        clan.save = () => this.saveClan(clan)
        return clan
    }

    playerDefault(path, fallback) {
        if (config.Player?.StartDefault) {
            const defaults = {
                'StartingScore': 0,
                'StartingLevel': 1,
                'StartingExperience': 0,
                'StartingResources.Gold': 750,
                'StartingResources.Mana': 750,
                'StartingResources.DarkMana': 0,
                'StartingResources.Diamonds': 500
            }
            return defaults[path] ?? fallback
        }

        const parts = path.split('.')
        let value = config.Player
        for (const part of parts) {
            value = value?.[part]
        }
        return value ?? fallback
    }

    safeLimit(limit) {
        const parsed = Number.parseInt(limit, 10)
        if (!Number.isFinite(parsed)) return 20
        return Math.min(Math.max(parsed, 1), 1000)
    }
}

// A clan badge is a data id (13000000 + badge index). Older rows hold a bare index such as 1
// (the old default), which the game cannot look up: it draws no badge and crashes on the Edit screen.
function normalizeBadge(value) {
    const badge = Number(value)
    if (!Number.isFinite(badge) || badge <= 0) return 13000000
    return badge < 13000000 ? 13000000 + badge : badge
}

function parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback
    if (Array.isArray(value) || typeof value === 'object') return value

    try {
        const parsed = JSON.parse(value)
        return parsed ?? fallback
    } catch {
        return fallback
    }
}

function stringifyJson(value) {
    return JSON.stringify(value ?? [])
}

function escapeIdentifier(value) {
    return String(value).replace(/`/g, '``')
}

/**
 * Clan score = sum of member trophies / 2 (rounded down), like the real game.
 */
function calcClanScore(members) {
    const sum = (members || []).reduce((total, m) => total + (m.trophies || 0), 0)
    return Math.floor(sum / 2)
}

function buildMemberEntry(player, role) {
    return {
        highID: player.highID,
        lowID: player.lowID,
        name: player.name || '',
        role,
        trophies: player.trophies || 0,
        level: player.level || 1,
        league: player.league || 0,
        donated: 0,
        donationsReceived: 0,
        joinedAt: new Date().toISOString()
    }
}