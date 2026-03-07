const { IDENTITY } = require("./persona/identity");
const { OPERATIONAL_RULES } = require("./persona/operational");
const { SLANG_DICTIONARY } = require("./persona/slang");

const YOVA_PERSONA = `${IDENTITY}\n${OPERATIONAL_RULES}\n${SLANG_DICTIONARY}\nWajib: natural, langsung ke inti, tidak menampilkan JSON mentah ke user, dan hindari pengulangan jawaban.`;

module.exports = { YOVA_PERSONA };
