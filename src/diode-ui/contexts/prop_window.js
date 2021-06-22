import { REST_request } from "../../main";
import { parse_sdfg } from "../../utils/sdfg/json_serializer";
import * as DiodeTables from "../table.js";
import { DIODE_Context } from "./context";
const { $ } = globalThis;

export class DIODE_Context_PropWindow extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

        this._html_container = null;

        this.container.setTitle("Properties");
    }

    setupEvents(project) {
        super.setupEvents(project);

        const eh = this.diode.goldenlayout.eventHub;
        this.on(this.project().eventString('-req-display-properties'), (msg) => {
            setTimeout(() => eh.emit(this.project().eventString("display-properties"), 'ok'), 1);
            this.getHTMLContainer().innerHTML = "";
            let p = msg.params;
            if (typeof (p) == 'string')
                p = JSON.parse(p);
            this.diode.renderProperties(msg.transthis, msg.node, p, this.getHTMLContainer(), msg.options);
        });

        this.on(this.project().eventString('-req-render-free-vars'), msg => {
            setTimeout(() => eh.emit(this.project().eventString("render-free-vars"), 'ok'), 1);
            this.renderDataSymbols(msg.calling_context, msg.data);
        });
    }


    renderDataSymbolProperties(caller_id, symbol) {
        /*
            caller_id: .created of calling context (SDFG Context, mainly)
            symbol: [sym_name, {
                    .attributes: <attr_obj>
                    .type: <type name>
                }]
        */
        const reduced_node = {};
        reduced_node.data = () => symbol;
        this.diode.renderPropertiesInWindow(caller_id, reduced_node, symbol[1].attributes, {
            backaction: () => {
                // #TODO: Implement a quick way of getting back from here
            },
            type: "symbol-properties"
        });
    }

    removeDataSymbol(calling_context, data_name) {
        this.project().request(["delete-data-symbol-" + calling_context], x => {
        }, {
            params: data_name
        });
    }

    addDataSymbol(calling_context, data_type, data_name) {
        this.project().request(["add-data-symbol-" + calling_context], x => {
        }, {
            params: {
                name: data_name,
                type: data_type
            }
        });
    }

    renderDataSymbols(calling_context, data) {
        // #TODO: This creates the default state (as in same as render_free_symbols() in the old DIODE)
        if (data == null) {
            console.warn("Data has not been set - creating empty window");
            return;
        }
        const free_symbol_table = new DiodeTables.Table();
        free_symbol_table.setHeaders("Symbol", "Type", "Dimensions", "Controls");

        // Go over the undefined symbols first, then over the arrays (SDFG::arrays)
        const all_symbols = [...Object.keys(data.attributes.symbols), "SwitchToArrays", ...Object.entries(data.attributes._arrays)];

        const caller_id = calling_context;
        console.assert(caller_id != undefined && typeof (caller_id) == 'string');

        for (const x of all_symbols) {

            if (x == "SwitchToArrays") {
                // Add a delimiter
                const col = free_symbol_table.addRow("Arrays");
                col.childNodes.forEach(x => {
                    x.colSpan = 4;
                    x.style = "text-align:center;";
                });
                continue;
            }
            if (x[0] == "null" || x[1] == null || typeof x === 'string' || x instanceof String)
                continue;
            const edit_but = document.createElement('button');
            edit_but.addEventListener('click', _x => {
                this.renderDataSymbolProperties(caller_id, x);
            });
            edit_but.innerText = "Edit";
            const del_but = document.createElement('button');
            del_but.addEventListener('click', _x => {
                this.removeDataSymbol(caller_id, x[0]);
            });
            del_but.innerText = "Delete";
            const but_container = document.createElement('div');
            but_container.appendChild(edit_but);
            but_container.appendChild(del_but);
            free_symbol_table.addRow(x[0], x[1].type, x[1].attributes.dtype + "[" + x[1].attributes.shape + "]", but_container);
        }

        free_symbol_table.addRow("Add data symbols").childNodes.forEach(x => {
            x.colSpan = 4;
            x.style = "text-align:center;";
        });
        {
            const input_name = document.createElement("input");
            input_name.type = "text";
            input_name.placeholder = "Symbol name";
            const add_scalar = document.createElement("button");
            add_scalar.innerText = "Add Scalar";
            add_scalar.addEventListener("click", () => {
                this.addDataSymbol(caller_id, "Scalar", input_name.value);
            });
            const add_array = document.createElement("button");
            add_array.addEventListener("click", () => {
                this.addDataSymbol(caller_id, "Array", input_name.value);
            });
            add_array.innerText = "Add Array";

            const but_container = document.createElement("div");
            but_container.appendChild(add_scalar);
            but_container.appendChild(add_array);

            free_symbol_table.addRow(input_name, but_container).childNodes.forEach(x => {
                x.colSpan = 2;
                x.style = "text-align:center;";
            });

            const libnode_container = document.createElement("div");
            const expand_all = document.createElement("button");
            expand_all.addEventListener("click", () => {
                // Expand all library nodes
                REST_request("/dace/api/v1.0/expand/", {
                    sdfg: data,
                }, (xhr) => {
                    if (xhr.readyState === 4 && xhr.status === 200) {
                        const resp = parse_sdfg(xhr.response);
                        if (resp.error !== undefined) {
                            // Propagate error
                            this.diode.handleErrors(this, resp);
                        }

                        // Add to history
                        this.project().request(["append-history"], x => {
                        }, {
                            params: {
                                new_sdfg: resp.sdfg,
                                item_name: "Expand library nodes"
                            }
                        });
                    }
                });
            });
            expand_all.innerText = "Expand all library nodes";
            libnode_container.appendChild(expand_all);
            free_symbol_table.addRow(libnode_container);
        }

        this.getHTMLContainer().innerHTML = "";

        free_symbol_table.setCSSClass('free_symbol_table');
        free_symbol_table.createIn(this.getHTMLContainer());
    }

    getHTMLContainer() {
        const parent = $(this.container.getElement()).children(".sdfgpropdiv");
        return parent[0];
    }

    createFromState() {
        const p = this.getHTMLContainer();
        p.setAttribute("data-hint", '{"type": "DIODE", "name": "Property_Window"}');
        const state = this.getState();
        if (state.params != undefined && state.params.params != null) {
            const p = state.params;
            this.diode.renderProperties(p.transthis, p.node, JSON.parse(p.params), this.getHTMLContainer());
        }
    }

}
