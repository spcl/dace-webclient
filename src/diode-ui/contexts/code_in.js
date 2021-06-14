import { DIODE_Context } from "./context";


export class DIODE_Context_CodeIn extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);
        this.editor = null;
        this._terminal_identifer = null;

        this._markers = [];
    }

    setupEvents(project) {
        super.setupEvents(project);

        const transthis = this;

        const eh = this.diode.goldenlayout.eventHub;
        this.on(this._project.eventString('-req-input_code'), (msg) => {
            // Echo with data
            setTimeout(() => eh.emit(transthis._project.eventString('input_code'), this.getState()['code_content']), 1);
            transthis.editor.clearSelection();
        }, true);

        this.on(this.project().eventString('-req-new_error'), msg => {
            // Echo with data
            setTimeout(() => eh.emit(transthis._project.eventString('new_error'), 'ok'), 1);
            this.highlight_error(msg);
        });

        this.on(this.project().eventString('-req-highlight-code'), msg => {
            setTimeout(() => eh.emit(transthis._project.eventString('highlight-code'), 'ok'), 1);
            this.highlight_code(msg);
        });

        this.on(this.project().eventString('-req-set-inputcode'), msg => {
            setTimeout(() => eh.emit(transthis._project.eventString('set-inputcode'), 'ok'), 1);

            this.editor.setValue(msg);
            this.editor.clearSelection();
        });

        this.on(this.project().eventString('-req-clear-errors'), msg => {
            setTimeout(() => eh.emit(transthis._project.eventString('clear-errors'), 'ok'), 1);
            this.clearErrors();
        });

    }

    highlight_code(dbg_info) {
        const s_c = dbg_info.start_col;
        let e_c = dbg_info.end_col;
        if (e_c <= s_c) {
            // The source data is broken; work-around this limitation by setting the end-column has high as possible
            e_c = 2000;
        }
        const markerrange = new ace.Range(dbg_info.start_line - 1, s_c, dbg_info.end_line - 1, e_c);
        // Create a unique class to be able to select the marker later
        const uc = "chm_" + this.diode.getPseudorandom();

        const marker = this.editor.session.addMarker(
            markerrange,
            "code_highlight " + uc
        );

        this.editor.resize(true);
        this.editor.scrollToLine(dbg_info.start_line, true, true, () => {
        });
        this.editor.gotoLine(dbg_info.start_line, 10, true);

        setTimeout(() => {
            this.editor.getSession().removeMarker(marker);
        }, 5000);
    }

    clearErrors() {
        for (const m of this._markers) {
            this.editor.getSession().removeMarker(m);
        }
        this._markers = [];
    }

    highlight_error(error) {

        if (error.type == "SyntaxError") {
            let lineno = parseInt(error.line);
            const offset = parseInt(error.offset);
            const text = error.text;

            lineno -= 1;

            const lineval = this.editor.session.getLine(lineno);


            const start = lineval.indexOf(text.substring(0, text.length - 1));

            const markerrange = new ace.Range(lineno, start, lineno, start + text.length - 1);

            // Create a unique class to be able to select the marker later
            const uc = "sem_" + this.diode.getPseudorandom();

            const marker = this.editor.session.addMarker(
                markerrange,
                "syntax_error_highlight " + uc
            );

            this._markers.push(marker);

            // #TODO: Either find a way to display the error information directly as a tooltip (which ace does not seem to support trivially)
            // #TODO: or add a dedicated error-view.
        } else {
            console.log("Untreated error type", error);
        }
    }

    terminal_identifier() {
        return this._terminal_identifer;
    }

    compile(code) {
        for (const m of this._markers) {
            this.editor.getSession().removeMarker(m);
        }
        this._markers = [];
        this.diode.compile(this, code);
    }

    setEditorReference(editor) {
        this.editor = editor;

        const elem = this.container.getElement()[0];
        elem.addEventListener('resize', x => {
            this.editor.resize();
        });
    }


    compile_and_run(code) {

        const millis = this.diode.getPseudorandom();

        const terminal_identifier = "terminal_" + millis;

        // create a new terminal
        const terminal_config = {
            title: "Terminal",
            type: 'component',
            componentName: 'TerminalComponent',
            componentState: { created: millis }
        };
        this.diode.addContentItem(terminal_config);

        console.log("Server emitting to ", terminal_identifier);

        this._terminal_identifer = terminal_identifier;

        this.diode.gatherProjectElementsAndCompile(this, {} /*{ 'code': code}*/, {
            run: true,
            term_id: terminal_identifier
        });
    }

}
