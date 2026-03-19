function resolveCommandAlias(commandName, args) {
  const name = String(commandName || "").toLowerCase().trim();
  const rest = Array.isArray(args) ? [...args] : [];

  const playAliases = new Set([
    "putar",
    "putarkan",
    "puter",
    "puterin",
    "puterin",
    "putarin",
    "muter",
    "muterin",
    "setel",
    "mainkan",
  ]);

  if (playAliases.has(name)) {
    let nextArgs = rest;
    const first = String(nextArgs[0] || "").toLowerCase();
    if (["lagu", "musik", "music", "song"].includes(first)) {
      nextArgs = nextArgs.slice(1);
    }
    return { name: "play", args: nextArgs };
  }

  return null;
}

module.exports = { resolveCommandAlias };

