declare module 'coffeequate';

declare module '*.html' {
    const content: string;
    export default content;
}

declare module 'monaco-editor/esm/vs/editor/common/languages' {
    const TokenizationRegistry: {
        getOrCreate(languageId: string): Promise<any>;
    };
}
