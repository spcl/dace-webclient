import { SDFG_PropUtil } from "../../utils/sdfg/sdfg_parser";
import { find_exit_for_entry } from "../../utils/sdfg/sdfg_utils";
import { parse_sdfg } from "../../utils/sdfg/json_serializer";
import { ContextMenu } from "../../utils/context_menu";
import { DIODE_Context } from "./context";
import { SDFGRenderer } from "../../renderer/renderer";


export class DIODE_Context_SDFG extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

        this._message_handler = x => alert(x);

        this.renderer_pane = null;

        this._analysis_values = {};

        console.log("state", state);
    }

    saveToState(dict_value) {
        const renamed_dict = {};
        const json_list = ['sdfg_data', 'sdfg'];
        for (const x of Object.entries(dict_value)) {
            renamed_dict[x[0]] = (json_list.includes(x[0]) && typeof (x[1]) != 'string') ? JSON.stringify(x[1]) : x[1];
        }
        super.saveToState(renamed_dict);

        console.assert(this.getState().sdfg == undefined);
    }

    resetState(dict_value) {
        const renamed_dict = {};
        const json_list = ['sdfg_data', 'sdfg'];
        for (const x of Object.entries(dict_value)) {
            renamed_dict[x[0]] = (json_list.includes(x[0]) && typeof (x[1]) != 'string') ? JSON.stringify(x[1]) : x[1];
        }
        super.resetState(renamed_dict);
        console.assert(this.getState().sdfg == undefined);
    }

    getState() {
        const _state = super.getState();
        const _transformed_state = {};
        const json_list = ['sdfg_data', 'sdfg'];
        for (const x of Object.entries(_state)) {
            _transformed_state[x[0]] = (typeof (x[1]) == 'string' && json_list.includes(x[0])) ? JSON.parse(x[1]) : x[1];
        }
        return _transformed_state;
    }

    setupEvents(project) {
        super.setupEvents(project);

        const transthis = this;

        const eh = this.diode.goldenlayout.eventHub;
        this.on(this._project.eventString('-req-new-sdfg'), (msg) => {

            if (typeof (msg) == 'string')
                msg = parse_sdfg(msg);
            if (msg.sdfg_name === this.getState()['sdfg_name']) {
                // Ok
            } else {
                // Names don't match - don't replace this one then.
                // #TODO: This means that renamed SDFGs will not work as expected.
                return;
            }
            setTimeout(() => eh.emit(this.project().eventString('new-sdfg'), 'ok'), 1);
            this.create_renderer_pane(msg, true);
        });

        // #TODO: When multiple sdfgs are present, the event name
        // should include a hash of the target context
        this.on(this._project.eventString('-req-sdfg-msg'), msg => {

            let ret = this.message_handler_filter(msg);
            if (ret === undefined) {
                ret = 'ok';
            }
            setTimeout(() => eh.emit(transthis._project.eventString('sdfg-msg'), ret), 1);
        });

        this.on(this._project.eventString('-req-sdfg_props'), msg => {
            // Echo with data
            if (msg != undefined) {
                this.discardInvalidated(msg);
            }
            const resp = this.getChangedSDFGPropertiesFromState();
            const named = {};
            named[this.getState()['sdfg_name']] = resp;
            setTimeout(() => eh.emit(transthis._project.eventString('sdfg_props'), named), 1);
        }, true);

        this.on(this.project().eventString('-req-property-changed-' + this.getState().created), (msg) => {
            // Emit ok directly (to avoid caller timing out)
            setTimeout(() => eh.emit(this.project().eventString("property-changed-" + this.getState().created), "ok"), 1);

            if (msg.type == "symbol-properties") {
                this.symbolPropertyChanged(msg.element, msg.name, msg.value);
            }
            else
                this.propertyChanged(msg.element, msg.name, msg.value);

        }, true);

        this.on(this.project().eventString('-req-delete-data-symbol-' + this.getState().created), (msg) => {
            setTimeout(() => eh.emit(this.project().eventString("delete-data-symbol-" + this.getState().created), "ok"), 1);

            this.removeDataSymbol(msg);
        });

        this.on(this.project().eventString('-req-add-data-symbol-' + this.getState().created), (msg) => {
            setTimeout(() => eh.emit(this.project().eventString("add-data-symbol-" + this.getState().created), "ok"), 1);

            this.addDataSymbol(msg.type, msg.name);
        });

        this.on(this.project().eventString('-req-draw-perfinfo'), (msg) => {
            setTimeout(() => eh.emit(transthis._project.eventString('draw-perfinfo'), "ok"), 1);
            this._analysis_values = msg.map(x => ({
                forProgram: x[0],
                AnalysisName: x[1],
                runopts: x[2],
                forUnifiedID: x[3],
                forSuperSection: x[4],
                forSection: x[5],
                data: JSON.parse(x[6]),
            }));
            this.renderer_pane.drawAllPerfInfo();
        });

        this.on(this.project().eventString('-req-sdfg_object'), msg => {
            // Return the entire serialized SDFG
            const _state = this.getSDFGDataFromState();
            const sdfg = _state.type == 'SDFG' ? _state : _state.sdfg;
            const named = {};
            named[this.getState()['sdfg_name']] = sdfg;
            //named = JSON.stringify(named);
            setTimeout(() => eh.emit(this.project().eventString("sdfg_object"), named), 1);
        }, true);
    }

    removeDataSymbol(aname) {

        const o = this.getSDFGDataFromState();
        const sdfg = o['sdfg'];

        let found = false;
        for (const x of Object.keys(sdfg.attributes._arrays)) {
            if (x == aname) {
                // Matching name
                delete sdfg.attributes._arrays[x];
                found = true;
                break;
            }
        }
        if (!found)
            console.error("Did not find symbol " + name + " in SDFG, this is a fatal error");

        const old = this.getState();
        if (old.type == "SDFG")
            console.error("Defensive programming no longer allowed; change input");

        else
            old.sdfg_data.sdfg = sdfg;

        this.resetState(old);

        this.diode.refreshSDFG();
    }

    addDataSymbol(type, aname) {

        if (aname == "") {
            alert("Invalid symbol name. Enter a symbol name in the input field");
            return;
        }

        // Create a dummy element, then allow changing later
        let typestr = "";
        if (type == "Scalar")
            typestr = "Scalar";
        else if (type == "Array")
            typestr = "Array";
        const data = {
            type: typestr,
            attributes: {
                dtype: "int32",
            }
        };

        const o = this.getSDFGDataFromState();
        const sdfg = o['sdfg'];

        let found = false;
        for (const x of Object.keys(sdfg.attributes._arrays)) {
            if (x == aname) {
                // Matching name
                found = true;
                break;
            }
        }
        if (found) {
            this.diode.toast("Cannot add symbol", "A symbol with name " + aname + " does already exist.", "error", 3000);
            return;
        }

        sdfg.attributes._arrays[aname] = data;
        const old = this.getState();
        if (old.type == "SDFG")
            console.error("Defensive programming no longer allowed; change input");

        else
            old.sdfg_data.sdfg = sdfg;

        this.resetState(old);


        this.diode.refreshSDFG();
    }

    analysisProvider(aname, nodeinfo) {

        let unified_id = null;
        if (nodeinfo != null) {
            unified_id = (parseInt(nodeinfo.stateid) << 16) | parseInt(nodeinfo.nodeid);
        }
        console.log("analysisProvider", aname, nodeinfo);
        if (aname == "getstates") {

            const states = this._analysis_values.map(x => (x.forUnifiedID >> 16) & 0xFFFF);
            return states;
        } else if (aname == "getnodes") {
            const nodes = this._analysis_values.map(x => (x.forUnifiedID) & 0xFFFF);
            return nodes;
        } else if (aname == "all_vec_analyses") {
            const vec_analyses = this._analysis_values.filter(x => x.AnalysisName == 'VectorizationAnalysis');
            const fltrd_vec_analyses = vec_analyses.filter(x => x.forUnifiedID == unified_id);
            return fltrd_vec_analyses;
        } else if (aname == 'CriticalPathAnalysis') {
            const cpa = this._analysis_values.filter(x => x.AnalysisName == 'CriticalPathAnalysis');
            const filtered = cpa.filter(x => x.forUnifiedID == unified_id);
            return filtered;
        } else if (aname == 'ParallelizationAnalysis') {
            const pa = this._analysis_values.filter(x => x.AnalysisName == 'ThreadAnalysis');
            const filtered = pa.filter(x => x.forUnifiedID == unified_id);
            return filtered;
        } else if (aname == 'MemoryAnalysis') {
            const ma = this._analysis_values.filter(x => x.AnalysisName == 'MemoryAnalysis');
            const filtered = ma.filter(x => x.forUnifiedID == unified_id);
            return filtered;
        } else if (aname == 'MemOpAnalysis') {
            const moa = this._analysis_values.filter(x => x.AnalysisName == 'MemoryOpAnalysis');
            const filtered = moa.filter(x => x.forUnifiedID == unified_id);
            return filtered;
        } else if (aname == 'CacheOpAnalysis') {
            const coa = this._analysis_values.filter(x => x.AnalysisName == 'CacheOpAnalysis');
            const filtered = coa.filter(x => x.forUnifiedID == unified_id);
            return filtered;
        } else if (aname == "defaultRun") {
            // This pseudo-element returns a filter function that returns only elements from the "default" run configuration
            // #TODO: Make the default run configurable.
            // For now, the default run is the run with the most committed cores
            //return x => x.filter(y => y.runopts == '# ;export OMP_NUM_THREADS=4; Running in multirun config');
            return x => {
                const tmp = x.map(y => {
                    const r = [];
                    y.runopts.replace(/OMP_NUM_THREADS=(\d+)/gm, (m, p) => r.push(p));
                    return r;
                });
                const max_num = Math.max(...tmp.map(x => parseInt(x)));
                return x.filter(z => z.runopts == '# ;export OMP_NUM_THREADS=' + max_num + '; Running in multirun config');
            };
        } else {
            throw "#TODO";
        }
    }

    message_handler_filter(msg) {
        /*
            This function is a compatibility layer
        */
        msg = JSON.parse(msg);
        if (msg.sdfg_name != this.getState()['sdfg_name']) {
            return;
        }
        if (msg.type == 'clear-highlights') {
            if (this.highlighted_elements)
                this.highlighted_elements.forEach(e => {
                    if (e)
                        e.highlighted = false;
                });
            this.highlighted_elements = [];
            this.renderer_pane.draw_async();
        }
        if (msg.type == 'highlight-elements') {
            // Clear previously highlighted elements
            if (this.highlighted_elements)
                this.highlighted_elements.forEach(e => {
                    if (e)
                        e.highlighted = false;
                });
            this.highlighted_elements = [];

            // The input contains a list of multiple elements
            for (const x of msg.elements) {
                const sdfg_id = x[0], sid = x[1], nid = x[2];
                let elem = null;
                let graph = null;
                if (sdfg_id >= 0)
                    graph = this.renderer_pane.sdfg_list[sdfg_id];

                else
                    graph = this.renderer_pane.graph;

                // If graph is hidden, skip
                if (graph === undefined)
                    continue;

                if (sid == -1)
                    elem = graph.node(nid);
                else {
                    const state = graph.node(sid);
                    // If state is hidden, skip
                    if (state === undefined)
                        continue;
                    elem = state.data.graph.node(nid);
                }
                if (elem !== undefined)
                    this.highlighted_elements.push(elem);
            }
            this.highlighted_elements.forEach(e => {
                if (e)
                    e.highlighted = true;
            });
            this.renderer_pane.draw_async();
        } else {
            // Default behavior is passing through (must be an object, not JSON-string)
            //this._message_handler(msg);
        }
    }

    // Returns a goldenlayout component if exists, or null if doesn't
    has_component(comp_name, parent = null) {
        // If parent component not provided, use root window
        if (!parent)
            parent = this.diode.goldenlayout.root;
        if ('componentName' in parent && parent.componentName === comp_name)
            return parent;
        if ('contentItems' in parent) {
            for (const ci of parent.contentItems) {
                const result = this.has_component(comp_name, ci);
                if (result)
                    return result;
            }
        }
        return null;
    }

    render_free_variables(force_open) {
        let sdfg_dat = this.getSDFGDataFromState();
        if (sdfg_dat.type != "SDFG")
            sdfg_dat = sdfg_dat.sdfg;
        this.diode.replaceOrCreate(['render-free-vars'], 'PropWinComponent', {
            data: sdfg_dat,
            calling_context: this.created
        },
            () => {
                console.log("Calling recreation function");
                const config = {
                    type: 'component',
                    componentName: 'PropWinComponent',
                    componentState: {}
                };

                this.diode.addContentItem(config);
                setTimeout(() => this.render_free_variables(force_open), 1);
            });
    }

    merge_properties(node_a, aprefix, node_b, bprefix) {
        /*  Merges node_a and node_b into a single node, such that the rendered properties are identical
            when selecting either node_a or node_b.
        */
        const en_attrs = SDFG_PropUtil.getAttributeNames(node_a);
        const ex_attrs = SDFG_PropUtil.getAttributeNames(node_b);

        const new_attrs = {};

        for (const na of en_attrs) {
            const meta = SDFG_PropUtil.getMetaFor(node_a, na);
            if (meta.indirected) {
                // Most likely shared. Don't change.
                new_attrs['_meta_' + na] = meta;
                new_attrs[na] = node_a.attributes[na];
            } else {
                // Private. Add, but force-set a new Category (in this case, MapEntry)
                const mcpy = JSON.parse(JSON.stringify(meta));
                mcpy['category'] = node_a.type + " - " + mcpy['category'];
                new_attrs['_meta_' + aprefix + na] = mcpy;
                new_attrs[aprefix + na] = node_a.attributes[na];
            }

        }
        // Same for ex_attrs, but don't add if shared
        for (const xa of ex_attrs) {
            const meta = SDFG_PropUtil.getMetaFor(node_b, xa);
            if (!meta.indirected) {
                const mcpy = JSON.parse(JSON.stringify(meta));
                mcpy['category'] = node_b.type + " - " + mcpy['category'];
                mcpy['_noderef'] = node_b.node_id;
                new_attrs['_meta_' + bprefix + xa] = mcpy;
                new_attrs[bprefix + xa] = node_b.attributes[xa];
            }
        }
        // Copy the first node for good measure
        // TODO: Inhibits property update for map/array
        const ecpy = JSON.parse(JSON.stringify(node_a));
        ecpy.attributes = new_attrs;
        return ecpy;
    }

    getSDFGPropertiesFromState() {
        const o = this.getSDFGDataFromState();
        const props = o['sdfg_props'];

        return props;
    }

    getSDFGDataFromState() {
        const _state = this.getState();
        let o = null;
        if (_state.sdfg != undefined) {
            o = _state;
        } else {
            o = _state['sdfg_data'];
        }
        if ((typeof o) == 'string') {
            o = JSON.parse(o);
        }
        while (typeof o.sdfg == 'string') {
            o.sdfg = parse_sdfg(o.sdfg);
        }
        return o;
    }

    renderProperties(node) {
        /*
            node: object, duck-typed
                
        */
        const params = node.data;
        const transthis = this;

        // Render in the (single, global) property window
        this.diode.renderPropertiesInWindow(transthis, node, params);
    }

    getSDFGElementReference(node_id, state_id) {
        if (node_id != null && node_id.constructor == Object) {
            return this.getEdgeReference(node_id, state_id);
        } else {
            return this.getNodeReference(node_id, state_id);
        }
    }

    getEdgeReference(node_id, state_id) {
        const o = this.getSDFGDataFromState();
        const sdfg = o['sdfg'];

        if (state_id == undefined) {
            // Look for sdfg-level edges
            for (const e of sdfg.edges) {
                if (e.src == node_id.src && e.dst == node_id.dst) {
                    return [e.attributes.data, sdfg];
                }
            }
        }

        for (const x of sdfg.nodes) {
            if (x.id == state_id) {
                for (const e of x.edges) {

                    if (e.src == node_id.src && e.dst == node_id.dst) {
                        return [e.attributes.data, sdfg];
                    }
                }

                break;
            }
        }
    }

    getNodeReference(node_id, state_id) {
        const o = this.getSDFGDataFromState();
        const sdfg = o['sdfg'];

        for (const x of sdfg.nodes) {
            if (x.id == state_id) {

                if (node_id == null)
                    return [x, sdfg];
                for (const n of x.nodes) {

                    if (n.id == node_id) {
                        return [n, sdfg];
                    }
                }

                break;
            }
        }
    }


    symbolPropertyChanged(node, name, value) {
        /*
            A data symbol was changed.
        */
        console.log("symbolPropertyChanged", name, value);

        // Search arrays first
        const o = this.getSDFGDataFromState();
        const sdfg = o['sdfg'];

        let found = false;
        const d = node.data();
        for (const x of Object.keys(sdfg.attributes._arrays)) {
            if (x == d[0]) {
                // Matching name
                sdfg.attributes._arrays[x].attributes[name] = value;
                found = true;
                break;
            }
        }
        if (!found)
            console.error("Did not find symbol " + name + " in SDFG, this is a fatal error");

        const old = this.getState();
        if (old.type == "SDFG")
            console.error("Defensive programming no longer allowed; change input");

        else
            old.sdfg_data.sdfg = sdfg;

        this.resetState(old);

        this.diode.refreshSDFG();
    }

    propertyChanged(node, name, value) {
        /*
            When a node-property is changed, the changed data is written back
            into the state.
        */
        const nref = node.element;

        nref.attributes[name] = value;

        const sdfg = this.renderer_pane.sdfg;
        let old = this.getState();
        if (old.type == "SDFG")
            old = sdfg;

        else
            old.sdfg_data.sdfg = sdfg;

        this.resetState(old);

        this.diode.refreshSDFG();
    }


    create_renderer_pane(sdfg_data = undefined, update = false) {
        if (sdfg_data == undefined) {
            sdfg_data = this.getState()["sdfg_data"];
        }
        let tmp = sdfg_data;
        if ((typeof tmp) === 'string') {
            tmp = parse_sdfg(sdfg_data);
        } else {
            if ('sdfg' in sdfg_data)
                tmp = sdfg_data;

            else
                tmp = { sdfg: sdfg_data };
        }

        {
            // Load the properties from json instead of loading the old properties
            // This means deleting any property delivered
            // This is just so we don't accidentally use the old format
            console.assert(tmp.sdfg_props === undefined);

        }

        {
            // Reset the state to avoid artifacts
            const s = this.getState();
            console.assert(s.sdfg_data != undefined);
            delete s.sdfg_data;
            this.resetState(s);
        }
        this.saveToState({
            "sdfg_data": tmp
        });

        if (this.renderer_pane !== null)
            this.renderer_pane.set_sdfg(tmp.sdfg);
        else {
            const sdfv = new SDFGRenderer(tmp.sdfg, this.container.getElement()[0],
                (et, e, c, el, r, sle, ed) => this.on_renderer_mouse_event(et, e, c, el, r, sle, ed),
                null, false, 'white');
            this.renderer_pane = sdfv;
        }

        // Display data descriptors by default (in parallel to the creation of the renderer)
        this.render_free_variables(true);
    }

    on_renderer_mouse_event(evtype, event, canvas_coords, elements, renderer, selected_elements, ends_drag) {
        let state_only = false;
        const clicked_states = elements.states;
        const clicked_nodes = elements.nodes;
        const clicked_edges = elements.edges;
        const clicked_interstate_edges = elements.isedges;
        const clicked_connectors = elements.connectors;
        let total_elements = clicked_states.length + clicked_nodes.length + clicked_edges.length +
            clicked_interstate_edges.length + clicked_connectors.length;
        let foreground_elem = null;
        if (selected_elements.length > 0)
            foreground_elem = selected_elements[0];

        else
            total_elements = 0;


        // Clear context menu
        if (evtype === 'click' || evtype === 'doubleclick' || evtype === 'mousedown' || evtype === 'contextmenu' ||
            evtype === 'wheel') {
            if (this.contextmenu) {
                this.contextmenu.destroy();
                this.contextmenu = null;
            }
        }

        // Check if anything was clicked at all
        if (total_elements == 0 && evtype === 'click') {
            // Clear highlighted elements
            if (this.highlighted_elements)
                this.highlighted_elements.forEach(e => {
                    if (e)
                        e.stroke_color = null;
                });

            // Nothing was selected
            this.render_free_variables(false);
            return true;
        }
        if (total_elements == 0 && evtype === 'contextmenu') {
            const cmenu = new ContextMenu();
            cmenu.addOption("SDFG Properties", x => {
                this.render_free_variables(true);
            });
            cmenu.show(event.x, event.y);
            this.contextmenu = cmenu;
            return false;
        }

        if ((clicked_nodes.length + clicked_edges.length + clicked_interstate_edges.length) === 0) {
            // A state was selected
            if (clicked_states.length > 0)
                state_only = true;
        }

        let state_id = null, node_id = null;
        if (clicked_states.length > 0)
            state_id = clicked_states[0].id;
        if (clicked_interstate_edges.length > 0)
            node_id = clicked_interstate_edges[0].id;

        if (clicked_nodes.length > 0)
            node_id = clicked_nodes[0].id;
        else if (clicked_edges.length > 0)
            node_id = clicked_edges[0].id;


        if (evtype === "contextmenu") {
            // Context menu was requested
            const spos = { x: event.x, y: event.y };
            const sdfg_name = renderer.sdfg.attributes.name;

            const cmenu = new ContextMenu();

            ///////////////////////////////////////////////////////////
            // Collapse/Expand
            const sdfg = (foreground_elem ? foreground_elem.sdfg : null);
            let sdfg_elem = null;
            if (foreground_elem instanceof State)
                sdfg_elem = foreground_elem.data.state;
            else if (foreground_elem instanceof SDFGNode) {
                sdfg_elem = foreground_elem.data.node;

                // If a scope exit node, use entry instead
                if (sdfg_elem.type.endsWith("Exit"))
                    sdfg_elem = sdfg.nodes[foreground_elem.parent_id].nodes[sdfg_elem.scope_entry];
            }
            else
                sdfg_elem = null;

            // Toggle collapsed state
            if (sdfg_elem && 'is_collapsed' in sdfg_elem.attributes) {
                cmenu.addOption((sdfg_elem.attributes.is_collapsed) ? 'Expand' : 'Collapse',
                    x => {
                        sdfg_elem.attributes.is_collapsed = !sdfg_elem.attributes.is_collapsed;
                        this.renderer_pane.relayout();
                        this.renderer_pane.draw_async();
                    });
            }
            ///////////////////////////////////////////////////////////
            cmenu.addOption("Show transformations", x => {
                console.log("'Show transformations' was clicked");

                this.project().request(['highlight-transformations-' + sdfg_name], x => {
                }, {
                    params: {
                        state_id: state_id,
                        node_id: node_id
                    }
                });
            });
            cmenu.addOption("Apply transformation \u25B6", x => {
                console.log("'Apply transformation' was clicked");

                // Find available transformations for this node
                this.project().request(['get-transformations-' + sdfg_name], x => {
                    console.log("get-transformations response: ", x);

                    const tmp = Object.values(x)[0];

                    // Create a sub-menu at the correct position
                    const submenu = new ContextMenu();

                    for (const y of tmp) {
                        submenu.addOption(y.opt_name, x => {
                            this.project().request(['apply-transformation-' + sdfg_name], x => {
                            },
                                {
                                    params: y.id_name
                                });
                        });
                    }

                    submenu.show(spos.x + cmenu.width(), spos.y);
                }, {
                    params: {
                        state_id: state_id,
                        node_id: node_id
                    }
                });


                // Don't close the current context menu from this event
                x.preventDefault();
                x.stopPropagation();
            });
            cmenu.addOption("Show Source Code", x => {
                console.log("go to source code");
            });
            cmenu.addOption("Show Generated Code", x => {
                console.log("go to generated code");
            });
            cmenu.addOption("Properties", x => {
                console.log("Force-open property pane");
            });

            cmenu.show(spos.x, spos.y);
            this.contextmenu = cmenu;

            return false;
        }

        if (evtype !== "click")
            return false;

        // Clear highlighted elements
        if (this.highlighted_elements)
            this.highlighted_elements.forEach(e => {
                if (e)
                    e.stroke_color = null;
            });
        // Mark this element red
        this.highlighted_elements = selected_elements;

        // Render properties asynchronously
        setTimeout(() => {
            // Get and render the properties from now on
            console.log("sdfg", foreground_elem.sdfg);

            let dst_nodeid = null;
            if (foreground_elem instanceof Edge && foreground_elem.parent_id !== null) {
                const edge = foreground_elem.sdfg.nodes[state_id].edges[foreground_elem.id];
                dst_nodeid = edge.dst;
            }

            const render_props = element_list => {
                const properties = [];
                element_list.forEach(element => {
                    // Collect all properties and metadata for each element
                    const attr = element.attributes;
                    const akeys = Object.keys(attr).filter(x => !x.startsWith("_meta_"));

                    for (const k of akeys) {
                        const value = attr[k];
                        const meta = attr["_meta_" + k];
                        if (meta == undefined)
                            continue;

                        const pdata = JSON.parse(JSON.stringify(meta));
                        pdata.value = value;
                        pdata.name = k;

                        properties.push({
                            property: pdata, element: element, sdfg: foreground_elem.sdfg,
                            category: element.type + ' - ' + pdata.category
                        });
                    }
                });
                this.renderProperties({
                    data: properties
                });
            };

            if (foreground_elem instanceof Edge)
                render_props([foreground_elem.data]);
            else if (foreground_elem instanceof SDFGNode) {
                const n = foreground_elem.data.node;
                // Set state ID, if exists
                n.parent_id = foreground_elem.parent_id;
                const state = foreground_elem.sdfg.nodes[foreground_elem.parent_id];
                // Special case treatment for scoping nodes (i.e. Maps, Consumes, ...)
                if (n.type.endsWith("Entry")) {
                    // Find the matching exit node
                    const exit_node = find_exit_for_entry(state.nodes, n);

                    // Highlight both entry and exit nodes
                    const graph = renderer.sdfg_list[foreground_elem.sdfg.sdfg_list_id];
                    const gstate = graph.node(foreground_elem.parent_id);
                    const rnode = gstate.data.graph.node(exit_node.id);
                    this.highlighted_elements.push(rnode);

                    render_props([n, exit_node]);
                } else if (n.type.endsWith("Exit")) {
                    // Find the matching entry node and continue with that
                    const entry_id = parseInt(n.scope_entry);
                    const entry_node = state.nodes[entry_id];

                    // Highlight both entry and exit nodes
                    const graph = renderer.sdfg_list[foreground_elem.sdfg.sdfg_list_id];
                    const gstate = graph.node(foreground_elem.parent_id);
                    const rnode = gstate.data.graph.node(entry_node.id);
                    this.highlighted_elements.push(rnode);

                    render_props([entry_node, n]);
                } else if (n.type === "AccessNode") {
                    // Find matching data descriptor and show that as well
                    const ndesc = foreground_elem.sdfg.attributes._arrays[n.attributes.data];
                    render_props([n, ndesc]);
                }
                else
                    render_props([n]);
            } else if (foreground_elem instanceof State)
                render_props([foreground_elem.data.state]);

            this.highlighted_elements.forEach(e => {
                if (e)
                    e.stroke_color = "red";
            });
            renderer.draw_async();
        }, 0);

        // Timeout handler draws asynchronously
        return false;
    }
}
