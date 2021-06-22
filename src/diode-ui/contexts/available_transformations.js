import { stringify_sdfg } from "../../utils/sdfg/json_serializer";
import { DIODE_Context } from "./context";
const { $ } = globalThis;

export class DIODE_Context_AvailableTransformations extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

        this._tree_view = null;
        this._current_root = null;

        // Allow overflow
        const parent_element = this.container.getElement();
        $(parent_element).css('overflow', 'auto');

        this.operation_running = false;
    }

    setupEvents(project) {
        super.setupEvents(project);

        const transthis = this;

        const eh = this.diode.goldenlayout.eventHub;
        this.on(this._project.eventString('-req-extend-optgraph'), (msg) => {

            const o = msg;
            if (typeof (o) == "string") {
                JSON.parse(msg);
            }
            const sel = o[this.getState()['for_sdfg']];
            if (sel === undefined) {
                return;
            }
            setTimeout(() => eh.emit(transthis._project.eventString('extend-optgraph'), 'ok'), 1);

            this.create(sel);
        });

        this.on(this._project.eventString('-req-optpath'), msg => {
            const named = {};
            named[this.getState()['for_sdfg']] = [];
            setTimeout(() => eh.emit(transthis._project.eventString('optpath'), named), 1);
        });

        const sname = this.getState()['for_sdfg'];
        this.on(this._project.eventString('-req-new-optgraph-' + sname), msg => {
            // In any case, inform the requester that the request will be treated
            const o = JSON.parse(msg);
            const sel = o.matching_opts;
            if (sel === undefined) {
                //eh.emit(transthis._project.eventString('new-optgraph-' + sname), 'not ok');
                return;
            }
            setTimeout(() => eh.emit(transthis._project.eventString('new-optgraph-' + sname), 'ok'), 1);

            this.create(o);
        });

        this.on(this.project().eventString('-req-highlight-transformations-' + sname), msg => {

            this.getTransformations(msg).forEach(x => this.highlightTransformation(x));

        });

        this.on(this.project().eventString('-req-get-transformations-' + sname), msg => {

            const transforms = this.getTransformations(msg);

            setTimeout(() => eh.emit(transthis._project.eventString('get-transformations-' + sname), transforms), 1);
        });

        this.on(this.project().eventString('-req-apply-transformation-' + sname), msg => {

            const children = this.getState()['optstruct'];
            for (const c of Object.values(children)) {
                for (const d of c) {

                    if (d === undefined)
                        continue;
                    if (d.id_name == msg) {
                        // Call directly.
                        // (The click handler invokes the simple transformation)
                        d.representative.dispatchEvent(new Event('click'));
                    }
                }
            }
        });

        this.on(this.project().eventString('-req-locate-transformation-' + sname), msg => {
            this.locateTransformation(...JSON.parse(msg));
        });

        this.on(this.project().eventString('-req-apply-adv-transformation-' + sname), msg => {

            const x = JSON.parse(msg);
            this.applyTransformation(...x);
        });
        this.on(this.project().eventString('-req-append-history'), msg => {
            this.appendHistoryItem(msg.new_sdfg, msg.item_name);
        });

        this.on(this.project().eventString('-req-property-changed-' + this.getState().created), (msg) => {
            this.propertyChanged(msg.element, msg.name, msg.value);
            setTimeout(() => eh.emit(this.project().eventString("property-changed-" + this.getState().created), "ok"), 1);
        });
    }

    getTransformations(affecting) {
        const ret = [];
        const selstring = "s" + affecting.state_id + "_" + affecting.node_id;
        const children = this.getState()['optstruct'];
        for (const c of Object.values(children)) {
            for (const d of c) {

                if (d === undefined)
                    continue;
                const affects = d.affects;

                if (affects.includes(selstring)) {
                    ret.push(d);
                }
            }
        }
        return ret;
    }

    highlightTransformation(node) {
        const repr = node.representative;
        let s = repr.parentNode;
        while (s) {
            s.classList.remove("at_collapse");
            s = s.previousElementSibling;
        }

        $(repr).css('color', 'red');
        setTimeout(x => {
            $(repr).css('color', '');
        }, 5000);
    }

    propertyChanged(node, name, value) {
        return this.propertyChanged2(node, name, value);
    }

    propertyChanged2(node, name, value) {
        node.element[name] = value;
    }

    renderProperties(node, pos, apply_params) {
        /*
            node: The TreeNode for which to draw the properties.
        */
        const params = node.opt_params;

        const transthis = this;

        const reduced_node = {};
        reduced_node.data = () => node.opt_params;
        this.diode.renderPropertiesInWindow(transthis, reduced_node, params, {
            type: "transformation",
            sdfg_name: this.getState()['for_sdfg'],
            opt_name: node.opt_name,
            pos: pos,
            apply_params: apply_params,
        });
    }


    sendHighlightRequest(idstring_list) {
        this._project.request(['sdfg-msg'], resp => {
        }, {
            params: JSON.stringify({
                type: 'highlight-elements',
                sdfg_name: this.getState()['for_sdfg'],
                elements: idstring_list
            }),
            timeout: 1000
        });
    }

    sendClearHighlightRequest() {
        this._project.request(['sdfg-msg'], resp => {
        }, {
            params: JSON.stringify({
                sdfg_name: this.getState()['for_sdfg'],
                type: 'clear-highlights',
            }),
            timeout: 1000
        });
    }

    addNodes(og) {

        const full = {};
        // Load the available data
        for (const x of og) {
            if (full[x.opt_name] === undefined) {
                full[x.opt_name] = [];
            }
            full[x.opt_name].push(x);
        }
        const arrayed = [];
        for (const x of Object.entries(full)) {
            const k = x[0];
            const v = x[1];
            arrayed.push([k, v]);
        }
        const sorted = arrayed.sort((a, b) => a[0].localeCompare(b[0]));
        for (const z of sorted) {
            const y = z[0];
            const x = z[1];

            let i = 0;
            let container_node = undefined;
            if (x.length > 1) {

                container_node = document.createElement('div');
                container_node.classList = "flex_column";

                const c_title = document.createElement('div');
                {
                    const c_title_span = document.createElement("span");
                    c_title_span.innerText = y;
                    c_title.classList = "at_group_header";
                    c_title.appendChild(c_title_span);

                    c_title.addEventListener('click', x => {
                        c_title.classList.toggle("at_collapse");
                    });
                }

                container_node.appendChild(c_title);

                this._transformation_list.appendChild(container_node);
            }
            for (const n of x) {
                this.addNode(n, i, container_node);
                ++i;
            }
        }
        const _s = this.getState();
        _s.optstruct = full;
        this.saveToState(_s);
    }

    locateTransformation(opt_name, opt_pos, affects) {
        console.log("locateTransformation", arguments);

        this.sendHighlightRequest(affects);

        const _state = this.getState();
        const _repr = _state.optstruct[opt_name][opt_pos].representative;
        $(_repr).css("background", "green");

        setTimeout(() => {
            this.sendClearHighlightRequest();
            $(_repr).css("background", '');
        }, 1000);
    }

    applyTransformation(x, pos, _title) {
        if (this.operation_running)
            return;
        this.operation_running = true;
        const _state = this.getState();
        const optstruct = _state['optstruct'];
        const named = {};
        const cpy = JSON.parse(JSON.stringify(optstruct[x.opt_name][pos]));
        named[this.getState()['for_sdfg']] = [{
            name: _title,
            params: {
                props: cpy['opt_params']
            }
        }];

        const tmp = (x) => {
            // Compile after the transformation has been saved
            this.diode.gatherProjectElementsAndCompile(this, {
                optpath: named
            }, {
                sdfg_over_code: true
            }, () => {
                this.project().saveSnapshot(x['sdfg_object'], named);

                this.project().request(['update-tfh'], x => {
                    this.operation_running = false;
                }, {
                    on_timeout: () => {
                        this.operation_running = false;
                    }
                });
            }, () => {
                // On failure
                this.operation_running = false;
            });
        };

        this.project().request(['sdfg_object'], x => {
            console.log("Got snapshot", x);
            if (typeof (x.sdfg_object) == 'string')
                x.sdfg_object = JSON.parse(x.sdfg_object);

            setTimeout(tmp, 10, x);
        }, {});
    }

    appendHistoryItem(new_sdfg, item_name) {
        if (this.operation_running)
            return;
        this.operation_running = true;
        const named = {};
        named[this.getState()['for_sdfg']] = [{
            name: item_name,
            params: {}
        }];

        const tmp = () => {
            // Update SDFG
            this.diode.gatherProjectElementsAndCompile(this, {
                code: stringify_sdfg(new_sdfg)
            }, {});
        };

        this.project().request(['sdfg_object'], x => {
            console.log("Got snapshot", x);
            if (typeof (x.sdfg_object) == 'string')
                x.sdfg_object = JSON.parse(x.sdfg_object);

            this.project().saveSnapshot(x['sdfg_object'], named);

            this.project().request(['update-tfh'], x => {
                this.operation_running = false;
            }, {
                on_timeout: () => {
                    this.operation_running = false;
                }
            });

            setTimeout(tmp, 10);
        }, {});
    }

    addNode(x, pos = 0, parent_override = undefined) {

        let _title = x.opt_name;

        // Add a suffix
        if (pos != 0) {
            _title += "$" + pos;
        }
        x.id_name = _title;

        const at_list = (parent_override === undefined) ?
            this._transformation_list : parent_override;

        // Create the element
        const list_elem = document.createElement("div");
        list_elem.classList = "flex_row at_element";

        // Add a title-div
        const title = document.createElement("div");
        title.innerText = _title;

        title.addEventListener('mouseenter', _x => {
            this.sendHighlightRequest(x.affects);
        });
        title.addEventListener('mouseleave', _x => {
            this.sendClearHighlightRequest();
        });

        title.addEventListener('click', _x => {

            this.applyTransformation(x, pos, _title);
        });

        title.setAttribute('data-hint', '{"type": "transformation", "name": "' + x.opt_name + '"}');
        x.representative = title;

        // Add a control-div
        const ctrl = document.createElement("div");
        // Advanced button
        {
            const adv_button = document.createElement('b');
            adv_button.classList = "";
            adv_button.innerText = '...';

            adv_button.addEventListener('click', _x => {
                // Clicking this reveals the transformation properties
                this.renderProperties(x, pos, [x, pos, _title]);
            });

            ctrl.appendChild(adv_button);
        }
        // Help button
        /*
        {
            let help_button = document.createElement('i');
            help_button.classList = "";
            help_button.innerText = '?';
            help_button.setAttribute("data-hint", '{"type": "transformation", "name": "' + x.opt_name + '"}');
            help_button.addEventListener("click", _ev => this.diode.hint(_ev));
            ctrl.appendChild(help_button);
        }*/
        list_elem.appendChild(title);
        list_elem.appendChild(ctrl);


        at_list.appendChild(list_elem);
    }

    create(newstate = undefined) {
        if (newstate != undefined) {

            const _state = this.getState();
            Object.assign(_state, newstate);
            this.resetState(_state);
        }
        let _state = this.getState();
        if (typeof (_state) == 'string') {
            _state = JSON.parse(_state);
        }
        let matching_opts = undefined;
        if (_state.matching_opts != undefined) {
            matching_opts = _state.matching_opts;
        } else if (_state.optgraph_data != undefined) {
            const _data = JSON.parse(_state.optgraph_data);
            matching_opts = _data.matching_opts;
        }
        const parent = (this.container.getElement())[0];
        parent.innerHTML = '';

        const at_div = document.createElement('div');
        at_div.classList = "at_container";
        const at_list = document.createElement('div');

        this._transformation_list = at_list;

        at_div.appendChild(at_list);

        parent.appendChild(at_div);

        if (matching_opts != undefined) {
            this.addNodes(matching_opts);
        }
    }
}
