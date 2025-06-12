// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.


/**
 * Escape characters in a string for HTML representation.
 * @param s String to escape.
 * @returns Escaped HTML string.
 */
export function escapeHTML(s: string): string {
    const escapeCharacters = new Map<string, string>([
        ['&', '&amp;'],
        ['<', '&lt;'],
        ['>', '&gt;'],
        ['"', '&quot;'],
        ['\'', '&#039;'],
    ]);

    return s.replace(/[&<>"']/g, m => escapeCharacters.get(m)!);
}

/**
 * Sanetize HTML string, escaping illegal or reserved characters.
 * @param strings String to sanetize.
 * @param values  Values to sanetize.
 * @returns       Escaped and sanetized HTML string.
 */
export function htmlSanitize(
    strings: TemplateStringsArray, ...values: any[]
): string {
    return strings.length === 1 ? strings[0] : strings.reduce(
        (s, n, i) => `${s}${escapeHTML(String(values[i - 1]))}${n}`
    );
}
