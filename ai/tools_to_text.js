/**
 * Convert tools to text description for models that don't support native function calling
 * This allows Gemma models to understand available tools through prompt engineering
 */
function convertToolsToTextDescription(tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
        return '';
    }

    let description = 'TOOLS (reply with JSON to call one):\n';
    description += '{"type":"tool_call","name":"<tool_name>","arguments":{...}}\n\n';

    for (const tool of tools) {
        const func = tool.function;
        if (!func) continue;

        const name = func.name;
        const shortDesc = typeof func.description === "string" ? func.description.trim() : "";
        description += `- ${name}${shortDesc ? `: ${shortDesc}` : ""}\n`;

        const props = func.parameters?.properties;
        if (props && typeof props === "object") {
            const required = Array.isArray(func.parameters?.required) ? func.parameters.required : [];
            const entries = Object.entries(props);
            if (entries.length > 0) {
                const parts = entries.map(([paramName, paramDef]) => {
                    const isRequired = required.includes(paramName);
                    const type = paramDef?.type || "any";
                    const enumValues = Array.isArray(paramDef?.enum) ? ` enum=${paramDef.enum.join("|")}` : "";
                    return `${paramName}${isRequired ? "!" : ""}:${type}${enumValues}`;
                });
                description += `  args: ${parts.join(", ")}\n`;
            }
        }
    }

    return description;
}

module.exports = {
    convertToolsToTextDescription
};
