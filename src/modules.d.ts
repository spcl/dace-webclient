declare module 'coffeequate';

declare module '*.html' {
    const content: string;
    export default content;
}

declare module '@dagrejs/graphlib-dot' {
    const read: (dot: string) => graphlib.Graph;
}
