import { DIODE_Context } from "./context";


export class DIODE_Context_Terminal extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);
    }

    setEditorReference(editor) {
        this.editor = editor;
    }

    append(output) {
        const session = this.editor.getSession();
        session.insert({
            row: session.getLength(),
            column: 0
        }, output);

        const curr_str = session.getValue();

        // Extract performance information if available
        const re = /~#~#([^\n]+)/gm;
        const matches = [...curr_str.matchAll(re)];
        for (const m of matches) {
            console.log("Got match", m);
            // We want to access the second element (index 1) because it contains the list
            let perflist = m[1];
            // Because this is a python list, it may contain "'" (single quotes), which is invalid json
            perflist = perflist.replace(/\'/g, '');
            perflist = JSON.parse(perflist);
            perflist.sort((a, b) => a - b);
            const median_val = perflist[Math.floor(perflist.length / 2)];

            console.log("Got median execution time", median_val);
            this.project().request(['new-time'], () => {
            }, {
                params: {
                    time: median_val
                }
            });
        }

        this.container.extendState({
            "current_value": curr_str
        });
        this.editor.clearSelection();
    }

}
