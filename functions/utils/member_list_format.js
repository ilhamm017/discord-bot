function formatMemberList(items = [], offset = 0, total = null) {
  const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const list = items
    .map((m, idx) => {
      const name = m?.displayName || m?.username || m?.userId || "-";
      return `${safeOffset + idx + 1}. ${name}`;
    })
    .join("\n");

  const count = Array.isArray(items) ? items.length : 0;
  const rangeText =
    typeof total === "number" && total > 0
      ? ` (${safeOffset + 1}-${safeOffset + count} dari ${total})`
      : "";

  return {
    header: `Nih, ${count} member${rangeText}:`,
    body: list || "-",
  };
}

module.exports = {
  formatMemberList,
};
