#!/usr/bin/env node

/**
 * CLI Launcher for Discord Bot
 * Run this file to interact with the bot via command line interface
 * Usage: node cli.js
 */

const { startCli } = require("./functions/adapters/cli");

startCli();
