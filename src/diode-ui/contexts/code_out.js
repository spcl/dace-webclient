import { DIODE_Context } from "./context";


export class DIODE_Context_CodeOut extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

        this.editor = null;
    }

    setupEvents(project) {
        super.setupEvents(project);

        const transthis = this;

        const eh = this.diode.goldenlayout.eventHub;
        this.on(this._project.eventString('-req-new-codeout'), (msg) => {

            if (msg.sdfg_name != this.getState()['sdfg_name']) {
                // Name mismatch; ignore
                return;
            }
            // See DIODE Errata "GoldenLayout:EventResponses"
            //eh.emit(transthis.project().eventString('new-codeout'), 'ok')
            setTimeout(x => eh.emit(transthis.project().eventString('new-codeout'), 'ok'), 1);
            const extracted = msg;
            this.setCode(extracted);
        });
    }

    cleanCode(codestr) {
        // Removes '////DACE:'-comments in the output code
        return codestr.replace(/\s*\/\/\/\/\_\_DACE:[^\n]*/gm, "");
    }

    setCode(extracted) {
        const input = extracted;
        if (typeof extracted === "string") {
            extracted = JSON.parse(extracted);
        }

        if (typeof extracted.generated_code == "string") {
            this.editor.setValue(this.cleanCode(extracted.generated_code));
            this.editor.clearSelection();
        } else {
            // Probably an array type
            this.editor.setValue("");
            this.editor.clearSelection();
            for (const c of extracted.generated_code) {
                let v = c;
                if (extracted.generated_code.length > 1) {
                    v = "\n\n\n" + "#########  NEXT CODE FILE ############\n\n\n" + v;
                }
                const session = this.editor.getSession();
                session.insert({
                    row: session.getLength(),
                    column: 0
                }, this.cleanCode(v));
                this.editor.clearSelection();
            }
        }
        this.saveToState({ 'code': input });
    }

    setEditorReference(editor) {
        this.editor = editor;

        const elem = this.container.getElement()[0];
        elem.addEventListener('resize', x => {
            this.editor.resize();
        });
    }
}
