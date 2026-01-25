const ringkas = require("./ringkas");

module.exports = {
  name: "rangkum",
  description: "Alias untuk ringkas.",
  async execute(message, args) {
    return ringkas.execute(message, args);
  },
};
