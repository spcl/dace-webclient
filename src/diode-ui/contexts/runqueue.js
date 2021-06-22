import { REST_request } from "../../main.js";
import { DIODE_Context } from "./context";
const { $ } = globalThis;

export class DIODE_Context_Runqueue extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

    }

    setupEvents(project) {
        super.setupEvents(project);

        const transthis = this;

        const eh = this.diode.goldenlayout.eventHub;

        this._autorefresher = null;

    }

    destroy() {
        clearInterval(this._autorefresher);
        super.destroy();
    }

    refreshUI(data) {

        if (typeof (data) == 'string') {
            data = JSON.parse(data);
        }

        if (data.elements == undefined) {
            data.elements = [];
        }
        const base_element = $(this.container.getElement())[0];
        base_element.innerHTML = "";
        const container = document.createElement("div");
        $(container).css("overflow", "auto");
        $(container).width("100%");
        $(container).height("100%");
        const table = document.createElement("table");

        // Build the header
        const header = document.createElement("thead");
        const header_row = document.createElement("tr");
        const header_titles = ['position', 'clientID', 'state', 'options'];
        header_titles.map(x => {
            const h = document.createElement("th");
            h.innerText = x;
            return h;
        }).forEach(x => header_row.appendChild(x));

        header.appendChild(header_row);
        table.appendChild(header);

        const tbody = document.createElement("tbody");
        for (const x of data.elements) {

            let optparse = x.options;
            if (typeof (optparse) == 'string') {
            } else if (optparse == undefined) {
                if (x.output != undefined && x.type == "orphan") {
                    optparse = document.createElement("button");
                    optparse.onclick = click => {
                        this.diode.addContentItem({
                            'type': 'component',
                            'componentName': 'TerminalComponent',
                            'componentState': {
                                current_value: x.output
                            },
                            'title': 'Output'
                        });
                    };
                    optparse.innerText = "Output";
                }
            } else {
                if (optparse.type == undefined) {
                    optparse = optparse.perfopts;
                }
                optparse = optparse.mode + ", coresets " + optparse.core_counts;
            }
            const values = [
                x['index'],
                x['client_id'],
                x['state'],
                optparse
            ];
            const row = document.createElement("tr");
            values.map(y => {
                const c = document.createElement("td");
                if (typeof (y) == 'string' || typeof (y) == 'number')
                    c.innerText = y;
                else {
                    c.appendChild(y);
                }
                return c;
            }).forEach(y => row.appendChild(y));
            tbody.appendChild(row);
        }

        table.appendChild(tbody);


        container.appendChild(table);
        base_element.appendChild(container);
        $(table).DataTable();
    }

    create() {
        this._autorefresher = setInterval(x => {
            this.getCurrentQueue();
        }, 2000);
        $(this.container.getElement()).css("overflow", "auto");
        this.refreshUI({});
    }

    getCurrentQueue() {

        const post_params = {};
        REST_request("/dace/api/v1.0/dispatcher/list/", post_params, xhr => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                // Got response
                this.refreshUI(xhr.response);
            }
        });
    }

}
