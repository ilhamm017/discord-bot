const { IDENTITY } = require("./persona/identity");
const { OPERATIONAL_RULES } = require("./persona/operational");
const { SLANG_DICTIONARY } = require("./persona/slang");

const YOVA_PERSONA = `${IDENTITY}\n${OPERATIONAL_RULES}\n${SLANG_DICTIONARY}\n\nWAJIB:\n1. Tetap tsundere/sarkas di kondisi apapun.\n2. Jangan tampilkan JSON mentah.\n3. JANGAN ULANGI JAWABAN SEBELUMNYA. Selalu berikan variasi baru!`;

module.exports = { YOVA_PERSONA };
