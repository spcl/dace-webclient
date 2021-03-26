/*
Coordinates windows belonging to the same project.

*/
export class DIODE_Project {
    constructor(diode, project_id = undefined) {
        this._diode = diode;
        if (project_id === undefined || project_id === null) {
            this._project_id = diode.getPseudorandom();
        } else {
            this._project_id = project_id;
        }
        this.setup();
        this._callback = null;
        this._rcvbuf = {};
        this._waiter = {};

        this._listeners = {};

        this._closed_windows = [];

        this._blob = null;
    }

    clearTransformationHistory() {
        // Reset transformation history
        sessionStorage.removeItem("transformation_snapshots");
    }

    getTransformationSnapshots() {
        let sdata = sessionStorage.getItem("transformation_snapshots");
        if (sdata == null) {
            sdata = [];
        } else
            sdata = JSON.parse(sdata);

        return sdata;
    }

    getTransformationHistory() {
        const sdata = this.getTransformationSnapshots();
        return sdata.map(x => x[0]);
    }

    discardTransformationsAfter(index) {
        const sdata = this.getTransformationSnapshots();

        // Cut the tail off and resave
        sessionStorage.setItem("transformation_snapshots", JSON.stringify(sdata.slice(0, index)));
        // Send the update notification
        this.request(['update-tfh'], x => x, {});
    }

    saveSnapshot(sdfgs, changing_transformation) {
        /*
            Saves the current snapshot, defined by sdfgs and the current (new) transformation.

        */

        const sdata = this.getTransformationSnapshots();
        sdata.push([changing_transformation, sdfgs]);
        sessionStorage.setItem("transformation_snapshots", JSON.stringify(sdata));
    }

    reopenClosedWindow(name) {
        const window = this.getConfigForClosedWindow(name, true);
        this._diode.addContentItem(window);

        // Emit the reopen event
        this._diode.goldenlayout.eventHub.emit('window-reopened-' + name);
    }

    getConfigForClosedWindow(name, remove = true) {
        const list = this.getClosedWindowsList();
        const new_list = [];

        const rets = [];

        for (const x of list) {
            const cname = x[0];
            const state = x[1];

            if (state.created === name) {
                // Found the requested element

                rets.push([cname, state]);

                if (remove) {
                    // Don't put into the new list
                } else {
                    new_list.push([cname, state]);
                }
            } else {
                // Not found
                new_list.push([cname, state]);
            }
        }

        // Store back
        this.setClosedWindowsList(new_list);

        console.assert(rets.length === 1, "Expected only 1 match!");
        const ret = rets[0];

        // Build a config for this
        const config = {
            type: 'component',
            componentName: ret[0],
            componentState: ret[1]
        };

        return config;
    }

    setClosedWindowsList(new_list) {
        this._closed_windows = new_list;
        sessionStorage.setItem(this._project_id + "-closed-window-list", JSON.stringify(this._closed_windows));
    }

    clearClosedWindowsList() {
        this._closed_windows = [];

        sessionStorage.setItem(this._project_id + "-closed-window-list", JSON.stringify(this._closed_windows));
    }

    addToClosedWindowsList(componentName, state) {
        this._closed_windows = this.getClosedWindowsList();
        this._closed_windows.push([componentName, state]);

        try {
            sessionStorage.setItem(this._project_id + "-closed-window-list", JSON.stringify(this._closed_windows));
        } catch (e) {
            console.error(`Error when adding to closed windows list!`, e);
            sessionStorage.clear();
        }
    }

    getClosedWindowsList() {
        let tmp = sessionStorage.getItem(this._project_id + "-closed-window-list");
        if (typeof (tmp) === "string") {
            tmp = JSON.parse(tmp);
        }

        if (tmp === null) {
            return [];
        }
        return tmp;
    }

    eventString(suffix) {
        console.assert(this._project_id != null, "project id valid");
        return this._project_id + suffix;
    }

    startListening(event, id) {
        const hub = this._diode.goldenlayout.eventHub;

        const transthis = this;
        const cb = (msg) => {
            const tmp = transthis._rcvbuf[id][event];
            if (tmp instanceof Array) {
                transthis._rcvbuf[id][event].push(msg);
            } else if (tmp instanceof Object) {
                Object.assign(transthis._rcvbuf[id][event], msg);
            } else {
                transthis._rcvbuf[id][event] = msg;
            }
        };
        const params = [this.eventString(event), cb, this];
        hub.on(...params);

        this._listeners[id].push(params);
    }

    stopListening(id) {
        const hub = this._diode.goldenlayout.eventHub;
        for (const x of this._listeners[id]) {
            hub.unbind(...x);
        }
        delete this._listeners[id];
    }


    setup() {

    }

    static load(diode, project_name) {
        const pdata = DIODE_Project.getProjectData(project_name);

        const ret = new DIODE_Project(diode, pdata.project_id);


        // For simplicity, we copy the saved config over the current config

        // First, destroy the current layout
        diode.goldenlayout.destroy();

        // Then, we copy over the config
        sessionStorage.setItem("savedState", JSON.stringify(pdata.data));

        // ... and the project id
        sessionStorage.setItem("diode_project", ret._project_id);

        // ... and the transformation snapshots
        sessionStorage.setItem("transformation_snapshots", JSON.stringify(pdata.snapshots));

        // Reload the page (This will create a new goldenlayout with the specified data)
        window.location.reload();

        return ret;
    }

    static getProjectData(project_name) {
        const pdata = localStorage.getItem("project_" + project_name);
        if (pdata == null)
            throw "Project must exist";

        return JSON.parse(pdata);
    }

    static getSavedProjects() {
        const tmp = localStorage.getItem("saved_projects");
        if (tmp == null)
            return [];
        return JSON.parse(tmp);
    }

    createblob(data) {
        const blob = new Blob([data], {
            type: 'text/plain'
        });

        // If we are replacing a previously generated file we need to
        // manually revoke the object URL to avoid memory leaks.
        if (this._blob !== null) {
            window.URL.revokeObjectURL(this._blob);
        }

        this._blob = window.URL.createObjectURL(blob);

        return this._blob;
    }

    save() {
        // Save current open file as SDFG
        this.request(['sdfg_object'], x => {
            let sdfg = x.sdfg_object;
            let filename = null;
            if (typeof (sdfg) != 'string') {
                filename = Object.keys(x.sdfg_object)[0];
                sdfg = stringify_sdfg(Object.values(x.sdfg_object)[0]);
            } else {
                const sdfg_obj = parse_sdfg(sdfg);
                filename = sdfg_obj.attributes.name;
            }
            filename += '.sdfg';

            const link = document.createElement('a');
            link.setAttribute('download', filename);
            link.href = this.createblob(sdfg);
            document.body.appendChild(link);
            // wait for the link to be added to the document
            window.requestAnimationFrame(() => {
                const event = new MouseEvent('click');
                link.dispatchEvent(event);
                document.body.removeChild(link);
            });
        });
    }

    request(list, callback, options = {}) {
        /*
            options:
                timeout: Number                 ms to wait until on_timeout is called
                on_timeout: [opt] Function      Function called on timeout
                params: [opt] object            Parameters to pass with the request
        */
        const tmp = new DIODE_Project(this._diode, this._project_id);
        return tmp.__impl_request(list, callback, options);
    }

    __impl_request(list, callback, options = {}) {
        /*
            options:
                timeout: Number                 ms to wait until on_timeout is called
                on_timeout: [opt] Function      Function called on timeout
                params: [opt] object            Parameters to pass with the request
        */
        this._callback = callback;
        const params = options.params;
        const reqid = "id" + this._diode.getPseudorandom();
        // Clear potentially stale values
        this._rcvbuf[reqid] = {};
        this._listeners[reqid] = [];
        for (const x of list) {
            this.startListening(x, reqid);
            this._diode.goldenlayout.eventHub.emit(this.eventString("-req-" + x), params, this);
        }

        const transthis = this;
        const interval_step = 100;
        let timeout = options.timeout;

        this._waiter[reqid] = setInterval(() => {
            let missing = false;

            for (const x of list) {
                if (!(x in transthis._rcvbuf[reqid])) {
                    missing = true;
                    break;
                }
            }
            if (!missing) {
                clearInterval(transthis._waiter[reqid]);
                transthis.stopListening(reqid);
                transthis._waiter[reqid] = null;
                const tmp = transthis._rcvbuf[reqid];
                delete transthis._rcvbuf[reqid];
                return transthis._callback(tmp, options.timeout_id);
            } else if (timeout !== null) {
                timeout -= interval_step;
                if (timeout <= 0) {
                    // Timed out - fail silently
                    clearInterval(transthis._waiter[reqid]);
                    transthis.stopListening(reqid);
                    if (options.on_timeout != undefined) {
                        options.on_timeout(transthis._rcvbuf[reqid]);
                    }
                    transthis._waiter[reqid] = null;
                    delete transthis._rcvbuf[reqid];
                }
            }
        }, interval_step);
    }
}
