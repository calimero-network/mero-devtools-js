export function formatAjvErrors(errors = []) {
    return errors
        .map((e) => {
        const path = e.instancePath || '/';
        const msg = e.message ?? 'validation error';
        const where = path.replace(/\//g, '.').replace(/^\./, '');
        return `• ${where || '<root>'}: ${msg}`;
    })
        .join('\n');
}
//# sourceMappingURL=ajvFormat.js.map