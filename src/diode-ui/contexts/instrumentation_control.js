import { REST_request } from "../../main.js";
import { DIODE_Context } from "./context";


export class DIODE_Context_InstrumentationControl extends DIODE_Context {
    /*
        This context shows status and controls for the current instrumentation run.
        It is an interface and does not store data other than that needed to provide popouts.
        In particular, it does not display instrumentation results (this is done in the SDFG component).
    */
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

    }

    setupEvents(project) {
        super.setupEvents(project);

        let started = false;

        // Start updating interval
        this._update_timeout = setInterval(() => {
            REST_request("/dace/api/v1.0/dispatcher/list/", {}, xhr => {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    // Got response
                    let done = true;
                    const resp = JSON.parse(xhr.response);
                    const elems = resp.elements;
                    for (const e of elems) {
                        const o = e.options;
                        if (typeof (o) == 'string') {
                            console.log("o is ", o);
                            if (o == "endgroup") {
                                // At least started, not done yet
                                done = false;
                                started = true;
                            }
                        }
                    }

                    if (started && done) {
                        started = false;
                        this.diode.load_perfdata();
                    }
                }

            });
        }, 2000);
    }

    close() {
        clearInterval(this._update_timeout);
        this._update_timeout = null;
        super.close();
    }

    destroy() {
        super.destroy();
    }

    create() {
        const parent = this.container.getElement()[0];

        parent.innerHTML = "<h2>Instrumentation control</h2><p>Do not close this window while instrumented programs are running</p>";

        // Functionality provided in this context
        // - Download perfdata database
        // - Delete remote perfdata database (e.g. to run a new / different program)
        // - Wait for tasks to be done (to auto-update performance information)
        const download_but = document.createElement("a");
        download_but.innerText = "Download perfdata database";
        download_but.href = base_url + "/dace/api/v1.0/perfdata/download/" + this.diode.getClientID() + "/";
        download_but.download = "perfdata.sqlite3";

        const download_can_but = document.createElement("a");
        download_can_but.innerText = "Download CAN";
        download_can_but.href = base_url + "/dace/api/v1.0/can/download/" + this.diode.getClientID() + "/";
        download_can_but.download = "current.sqlite3";

        const delete_but = document.createElement("button");
        delete_but.innerText = "Delete remote database";
        delete_but.addEventListener("click", () => {
            REST_request("/dace/api/v1.0/perfdata/reset/", {
                client_id: this.diode.getClientID()
            }, x => {
            });
        });

        const delete_can_but = document.createElement("button");
        delete_can_but.innerText = "Delete remote CAN";
        delete_can_but.addEventListener("click", () => {
            REST_request("/dace/api/v1.0/can/reset/", {
                client_id: this.diode.getClientID()
            }, x => {
            });
        });

        const render_but = document.createElement("button");
        render_but.innerText = "Display instrumentation results";
        render_but.addEventListener("click", () => {
            this.diode.load_perfdata();
        });

        const roofline_but = document.createElement("button");
        roofline_but.innerText = "Show roofline";
        roofline_but.addEventListener("click", () => {
            this.diode.show_roofline();
        });

        const celem = document.createElement("div");
        celem.classList = "flex_column";

        celem.appendChild(download_but);
        celem.appendChild(download_can_but);
        celem.appendChild(delete_but);
        celem.appendChild(delete_can_but);
        celem.appendChild(render_but);
        celem.appendChild(roofline_but);

        parent.appendChild(celem);
    }

}
