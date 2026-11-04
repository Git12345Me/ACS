-- ACS (Apexpowa Clash Server) - MySQL / MariaDB schema for XAMPP.
-- Import in phpMyAdmin: Import tab -> choose this file -> Go.  (The server also creates all of this itself on first start.)

CREATE DATABASE IF NOT EXISTS `MagicDatabase` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `MagicDatabase`;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `players` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `highID` INT NOT NULL DEFAULT 0,
    `lowID` INT NOT NULL,
    `token` VARCHAR(190) NOT NULL,
    `name` VARCHAR(255) NOT NULL DEFAULT 'You',
    `village` LONGTEXT NOT NULL,
    `nameChangesCount` INT NOT NULL DEFAULT 0,
    `facebookID` VARCHAR(255) NOT NULL DEFAULT '',
    `trophies` INT NOT NULL DEFAULT 0,
    `highestTrophies` INT NOT NULL DEFAULT 0,
    `shieldDurationSeconds` INT NOT NULL DEFAULT 0,
    `guardDurationSeconds` INT NOT NULL DEFAULT 0,
    `personalDurationSeconds` INT NOT NULL DEFAULT 0,
    `attackRating` INT NOT NULL DEFAULT 0,
    `attackKFactor` INT NOT NULL DEFAULT 0,
    `cumulativePurchasedDiamonds` INT NOT NULL DEFAULT 0,
    `attackWinCount` INT NOT NULL DEFAULT 0,
    `attackLoseCount` INT NOT NULL DEFAULT 0,
    `defendWinCount` INT NOT NULL DEFAULT 0,
    `defendLoseCount` INT NOT NULL DEFAULT 0,
    `allianceCastleGold` INT NOT NULL DEFAULT 0,
    `allianceCastleMana` INT NOT NULL DEFAULT 0,
    `allianceCastleDarkMana` INT NOT NULL DEFAULT 0,
    `league` INT NOT NULL DEFAULT 0,
    `level` INT NOT NULL DEFAULT 1,
    `xpPoints` INT NOT NULL DEFAULT 0,
    `gold` BIGINT NOT NULL DEFAULT 0,
    `mana` BIGINT NOT NULL DEFAULT 0,
    `darkMana` BIGINT NOT NULL DEFAULT 0,
    `diamonds` BIGINT NOT NULL DEFAULT 0,
    `victories` INT NOT NULL DEFAULT 0,
    `tutorialSteps` INT NOT NULL DEFAULT 0,
    `heroes` INT NOT NULL DEFAULT 0,
    `inClan` TINYINT NOT NULL DEFAULT 0,
    `ClanHighID` INT NOT NULL DEFAULT 0,
    `ClanLowID` INT NOT NULL DEFAULT 1,
    `ClanRole` INT NOT NULL DEFAULT 0,
    `army` LONGTEXT NOT NULL,
    `spells` LONGTEXT NOT NULL,
    `achievements` LONGTEXT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_players_identity` (`highID`, `lowID`),
    UNIQUE KEY `uq_players_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `clans` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `highID` INT NOT NULL DEFAULT 0,
    `lowID` INT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `trophies` INT NOT NULL DEFAULT 0,
    `requiredTrophies` INT NOT NULL DEFAULT 0,
    `badge` INT NOT NULL DEFAULT 13000000,
    `avatarID` INT NOT NULL DEFAULT 0,
    `type` INT NOT NULL DEFAULT 0,
    `location` INT NOT NULL DEFAULT 0,
    `warFrequency` INT NOT NULL DEFAULT 0,
    `origin` INT NOT NULL DEFAULT 0,
    `members` LONGTEXT NOT NULL,
    `messages` LONGTEXT NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_clans_identity` (`highID`, `lowID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `main_accounts` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(32) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `createdAt` BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_main_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `main_villages` (
    `mainID` INT UNSIGNED NOT NULL,
    `highID` INT NOT NULL DEFAULT 0,
    `lowID` INT NOT NULL,
    `position` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`highID`, `lowID`),
    KEY `idx_main_villages_main` (`mainID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `village_passwords` (
    `highID` INT NOT NULL DEFAULT 0,
    `lowID` INT NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    PRIMARY KEY (`highID`, `lowID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `redeem_claims` (
    `code` VARCHAR(64) NOT NULL,
    `highID` INT NOT NULL DEFAULT 0,
    `lowID` INT NOT NULL,
    `claimedAt` BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`code`, `highID`, `lowID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Indexes the server adds for large accounts lists (leaderboards, clan member lists, join list).
ALTER TABLE `players` ADD INDEX `idx_players_lowid` (`lowID`);
ALTER TABLE `players` ADD INDEX `idx_players_trophies` (`trophies`);
ALTER TABLE `players` ADD INDEX `idx_players_clan` (`inClan`,`ClanHighID`,`ClanLowID`);
ALTER TABLE `clans` ADD INDEX `idx_clans_trophies` (`trophies`);
ALTER TABLE `clans` ADD INDEX `idx_clans_type_trophies` (`type`,`trophies`);

CREATE TABLE IF NOT EXISTS `device_accounts` (
    `deviceKey` VARCHAR(64) NOT NULL,
    `highID` INT NOT NULL DEFAULT 0,
    `lowID` INT NOT NULL,
    `updatedAt` BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`deviceKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
