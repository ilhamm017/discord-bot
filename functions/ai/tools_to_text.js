/**
 * Convert tools to text description for models that don't support native function calling
 * This allows Gemma models to understand available tools through prompt engineering
 */
function convertToolsToTextDescription(tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
        return '';
    }

    let description = '\n\n=====================\nAVAILABLE TOOLS\n=====================\n\n';
    description += 'You have access to the following tools. To use a tool, respond with JSON in this format:\n';
    description += '{"type": "tool_call", "name": "<tool_name>", "arguments": {<parameters>}}\n\n';
    description += 'Available tools:\n\n';

    for (const tool of tools) {
        const func = tool.function;
        if (!func) continue;

        description += `--- ${func.name} ---\n`;
        description += `Description: ${func.description}\n`;

        if (func.parameters && func.parameters.properties) {
            description += 'Parameters:\n';
            const props = func.parameters.properties;
            const required = func.parameters.required || [];

            for (const [paramName, paramDef] of Object.entries(props)) {
                const isRequired = required.includes(paramName);
                const requiredMark = isRequired ? ' (REQUIRED)' : ' (optional)';
                description += `  - ${paramName}${requiredMark}: ${paramDef.type}`;
                if (paramDef.description) {
                    description += ` - ${paramDef.description}`;
                }
                if (paramDef.default !== undefined) {
                    description += ` [default: ${paramDef.default}]`;
                }
                description += '\n';
            }
        }
        description += '\n';
    }

    return description;
}

module.exports = {
    convertToolsToTextDescription
};
