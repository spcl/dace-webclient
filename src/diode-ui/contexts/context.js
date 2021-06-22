import { DIODE_Project } from "../diode_project";


export class DIODE_Context {
    constructor(diode, gl_container, state) {
        this.diode = diode;
        this.container = gl_container;
        this.initial_state = state;

        this.created = state.created;
        if (this.created == undefined) {
            this.created = this.diode.getPseudorandom();
            this.saveToState({ created: this.created });
        }
        this._project = null;
        if (state.project_id != undefined && state.project_id != null && state.project_id != "null") {
            this._project = new DIODE_Project(this.diode, state.project_id);
        }

        this._event_listeners = [];
        this._event_listeners_closed = []; // Listeners that are installed on closed windows (NOTE: These are NOT active on open windows)

        this._no_user_destroy = false; // When true, all destroy()-events are assumed to be programmatic
    }

    project() {
        console.assert(this._project != null, "Project invalid");
        return this._project;
    }

    on(name, data, keep_alive_when_closed = false) {
        const eh = this.diode.goldenlayout.eventHub;

        const params = [name, data];
        eh.on(...params);
        this._event_listeners.push(params);

        if (keep_alive_when_closed) {
            // NOTE: The new function has to be created because the function cannot be identical
            // (This is, because the handler is removed by (name, function) pairs)
            this.closed_on(name, (x) => data(x));
        }
    }

    // same as on(), but only active when the window is closed (in the closed windows list)
    closed_on(name, data) {


        const params = [name, data];
        this._event_listeners_closed.push(params);
    }

    removeClosedWindowEvents() {
        // This function has to be called when reopening from the closed windows list
        // DO NOT call inside destroy()!
        const eh = this.diode.goldenlayout.eventHub;
        for (const x of this._event_listeners_closed) {
            eh.unbind(...x);
        }
        this._event_listeners_closed = [];
    }

    destroy() {

        console.log("destroying", this);
        // Unlink all event listeners
        const eh = this.diode.goldenlayout.eventHub;
        for (const x of this._event_listeners) {
            eh.unbind(...x);
        }
        this._event_listeners = [];
    }

    close() {
        /*
            The difference to destroy: close() is called when the USER clicks close,
            destroy will be called afterwards when the element is actually removed
        */
        // Add to closed-windows list
        console.log("closing", this);

        this.project().addToClosedWindowsList(this.container._config.componentName, this.getState());

        // Install the event listeners to listen when the window is closed
        const eh = this.diode.goldenlayout.eventHub;
        for (const params of this._event_listeners_closed) {
            eh.on(...params);
        }
    }

    setupEvents(project) {
        if (this._project == null) {
            this._project = project;
        }

        this.container.extendState({ 'project_id': this._project.eventString('') });

        this.on('destroy-' + this.getState().created, msg => {
            if (!this._no_user_destroy) {
                // _might_ be a user destroy - call close
                this.close();
            }
            this.destroy();
        });

        this.on('enter-programmatic-destroy', msg => {
            this._no_user_destroy = true;
            console.log("Entering programmatic reordering", this);
        });
        this.on('leave-programmatic-destroy', msg => {
            this._no_user_destroy = false;
            console.log("Leaving programmatic reordering", this);
        });

        this.closed_on('window-reopened-' + this.getState().created, x => {
            this.removeClosedWindowEvents();
        });
    }

    getState() {
        return this.container.getState();
    }

    saveToState(dict_value) {
        this.container.extendState(dict_value);
    }

    resetState(dict_value = {}) {
        this.container.setState(dict_value);
    }

    saveToPersistentState(key, value) {
        localStorage.setItem(key, value);
    }

    getPersistentState(key) {
        return localStorage.getItem(key);
    }
}
