import { DIODE_Context } from "./context";


export class DIODE_Context_Error extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

        this.editor = null;
    }

    setupEvents(project) {
        super.setupEvents(project);

        const transthis = this;

        const eh = this.diode.goldenlayout.eventHub;
        this.on(this._project.eventString('-req-new-error'), (msg) => {

            setTimeout(x => eh.emit(transthis.project().eventString('new-error'), 'ok'), 1);
            const extracted = msg;
            this.setError(extracted);
        });
    }

    setError(error) {
        console.log("error", error);

        let error_string = "";
        if (typeof (error) == "string")
            this.editor.setValue(error);
        else if (Array.isArray(error)) {
            for (const e of error) {
                if (e.msg != undefined) {
                    error_string += e.msg;
                }
                console.log("Error element", e);
            }
            this.editor.setValue(error_string);
        }
        this.saveToState({ 'error': error });
    }

    setEditorReference(editor) {
        this.editor = editor;

        const elem = this.container.getElement()[0];
        elem.addEventListener('resize', x => {
            this.editor.resize();
        });
    }
}
