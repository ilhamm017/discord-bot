const logger = require("../../../utils/logger");
const { saveQueueState } = require("../../../storage/db");

let panelUpdater = null;

function setPanelUpdater(updater) {
    panelUpdater = typeof updater === "function" ? updater : null;
}

async function persistQueueState(state) {
    if (!state?.guildId) return;
    await saveQueueState(state.guildId, state);
}

function notifyPanel(state, reason) {
    if (!panelUpdater) return;
    Promise.resolve()
        .then(() => panelUpdater(state, reason))
        .catch((error) => {
            logger.warn("Failed updating control panel.", error);
        });
}

module.exports = {
    setPanelUpdater,
    persistQueueState,
    notifyPanel,
};
