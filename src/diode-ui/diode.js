// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

import { REST_request, FormBuilder, setup_drag_n_drop } from "../main";
import { Appearance } from "./diode_appearance";
import { SDFG_Parser } from "../utils/sdfg/sdfg_parser";
import { parse_sdfg, stringify_sdfg } from "../utils/sdfg/json_serializer";
import * as DiodeTables from "./table";
import { DIODE_Settings } from "./diode_settings";
import { DIODE_Project } from "./diode_project";
const { $ } = globalThis;

export class DIODE {
    constructor() {
        this._settings = new DIODE_Settings();
        this._debouncing = {};

        this._background_projects = [];
        this._current_project = null;

        this._stale_data_button = null;

        this._shortcut_functions = {
            /*
            format:
            key: {
                .alt: Trigger if altKey is pressed
                .ctrl: Trigger if ctrlKey is pressed
                .function: Function to run
                .state: Multi-key only: state in state machine
                .expect: The state transitions (without the first state transition)
            }
            */
        };

        this._creation_counter = 0;

        // Load a client_id
        this._client_id = localStorage.getItem("diode_client_id");
        if (this._client_id == null) {
            this._client_id = this.getPseudorandom();
            localStorage.setItem("diode_client_id", this._client_id);
        }

        // Initialize appearance
        this._appearance = new Appearance(localStorage.getItem("DIODE/Appearance"));
        this._appearance.setOnChange(x => {
            localStorage.setItem("DIODE/Appearance", JSON.stringify(x.toStorable()))
        });
    }

    setupEvents() {
        this.goldenlayout.eventHub.on(this.project().eventString('-req-show_stale_data_button'), x => {
            this.__impl_showStaleDataButton();
        });
        this.goldenlayout.eventHub.on(this.project().eventString('-req-remove_stale_data_button'), x => {
            this.__impl_removeStaleDataButton();
        });
        this.goldenlayout.eventHub.on(this.project().eventString('-req-show_loading'), x => {
            this.__impl_showIndeterminateLoading();
        });
        this.goldenlayout.eventHub.on(this.project().eventString('-req-hide_loading'), x => {
            this.__impl_hideIndeterminateLoading();
        });

        // Install the hint mechanic on the whole window
        window.addEventListener('contextmenu', ev => {
            console.log("contextmenu requested on", ev.target);

            this.hint(ev);
        });
    }

    getRunConfigs(name = undefined) {
        let tmp = localStorage.getItem("diode_run_configs");
        if (tmp != null) {
            tmp = JSON.parse(tmp);
        } else {
            // Create a default
            tmp = [{
                "Configuration name": "default",
                "Host": "localhost",
                "Use SSH": true,
                "SSH Key": this.pubSSH(),
                "SSH Key override": "",
                "Instrumentation": "off",
                "Number of threads": "[0]"
            }];
        }

        if (name != undefined) {
            const ret = tmp.filter(x => x['Configuration name'] == name);
            if (ret.length == 0) {
                // Error
                console.error("Could not find a configuration with that name", name);
            } else {
                return ret[0];
            }
        }
        return tmp;
    }

    addToRunConfigs(config) {
        delete config['SSH Key']; // Don't save large, unnecessary data
        const existing = this.getRunConfigs();

        let i = 0;
        for (const x of existing) {
            if (x['Configuration name'] == config['Configuration name']) {
                // Replace
                existing[i] = config;
                break;
            }
            ++i;
        }
        if (i >= existing.length) {
            existing.push(config);
        }
        existing.sort((a, b) => a['Configuration name'].localeCompare(b['Configuration name']));
        localStorage.setItem("diode_run_configs", JSON.stringify(existing));
    }

    setCurrentRunConfig(name) {
        sessionStorage.setItem("diode_current_run_config", name);
    }

    getCurrentRunConfigName() {
        const tmp = sessionStorage.getItem("diode_current_run_config");
        if (tmp == null) {
            return "default";
        } else {
            return tmp;
        }
    }

    getCurrentRunConfig() {
        const config = this.getRunConfigs(this.getCurrentRunConfigName());
        return config;
    }

    applyCurrentRunConfig() {
        const config = this.getCurrentRunConfig();

        let new_settings = {};

        new_settings = {
            ...new_settings, ...{
                "execution/general/host": config['Host']
            }
        };

        // Apply the runconfig values to the dace config
        if (config['Use SSH']) {


            const keyfile_string = /\S/.test(config['SSH Key override']) ? (" -i " + config['SSH Key override'] + " ") : " ";
            new_settings = {
                ...new_settings, ...{
                    "execution/general/execcmd": ("ssh -oBatchMode=yes" + keyfile_string + "${host} ${command}"),
                    "execution/general/copycmd_r2l": ("scp -B" + keyfile_string + " ${host}:${srcfile} ${dstfile}"),
                    "execution/general/copycmd_l2r": ("scp -B" + keyfile_string + " ${srcfile} ${host}:${dstfile}"),
                }
            };
        } else {
            // Use standard / local commands
            new_settings = {
                ...new_settings, ...{
                    "execution/general/execcmd": "${command}",
                    "execution/general/copycmd_r2l": "cp ${srcfile} ${dstfile}",
                    "execution/general/copycmd_l2r": "cp ${srcfile} ${dstfile}",
                }
            };
        }

        // Instrumentation settings are not to be applied here, but later when the run request is actually sent

        const ret = new Promise((resolve, reject) => {
            const post_params = {
                client_id: this.getClientID(),
                ...new_settings
            };
            REST_request("/dace/api/v1.0/preferences/set", post_params, (xhr) => {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    resolve(config);
                } else if (xhr.status !== 0 && !(xhr.status + "_").startsWith("2")) {
                    reject();
                }
            });
        });

        return ret;
    }

    pubSSH() {
        const cached = localStorage.getItem('diode_pubSSH');
        if (cached != null) {
            return cached;
        }
        REST_request("/dace/api/v1.0/getPubSSH/", undefined, xhr => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                const j = JSON.parse(xhr.response);
                if (j.error == undefined) {
                    const t = j.pubkey;
                    localStorage.setItem('diode_pubSSH', t);
                } else {
                    alert(j.error);
                }
            }
        }, 'GET');
    }

    static getHostList() {
        const tmp = localStorage.getItem("diode_host_list");
        if (tmp == null) return ['localhost'];
        else return JSON.parse(tmp);
    }

    static setHostList(list) {
        localStorage.setItem("diode_host_list", JSON.stringify(list));
    }

    hint(ev) {
        /*
            ev: Event triggering this hint.
        */

        const create_overlay = (_h, elem) => {
            // Found hint data
            const fulldata = JSON.parse(_h);

            // #TODO: Link to documentation instead of using this placeholder
            $(elem).w2overlay("<div><h2>Help for category " + fulldata.type + "</h2>" + fulldata.name + "</div>");
        };

        const target = ev.target;
        let _h = target.getAttribute("data-hint");
        if (_h == null) {
            // Iterate chain
            if (!ev.composed) return;
            const x = ev.composedPath();
            for (const e of x) {
                if (e.getAttribute != undefined) {
                    _h = e.getAttribute("data-hint");
                } else _h = null;

                if (_h != null) {
                    create_overlay(_h, e);
                    ev.stopPropagation();
                    ev.preventDefault();
                    break;
                }
            }
            return;
        } else {
            create_overlay(_h, target);
            ev.stopPropagation();
            ev.preventDefault();
        }

        console.log("Got hint data", _h);

    }

    openUploader(purpose = "") {

        w2popup.open({
            title: "Upload a code file",
            body: `
<div class="w2ui-centered upload_flexbox">
    <label for="file-select" style="flex-grow: 1">
        <div class="diode_uploader" id='upload_box'>
            <div class="uploader_text">
                Drop file here or click to select a file
            </div>
        </div>
    </label>
    <input id="file-select" type="file"  accept=".py,.m,.sdfg" style="position:absolute;"/>
</div>
`,
            buttons: '',
            showMax: true
        });
        let x = $('#upload_box');
        if (x.length == 0) {
            throw "Error: Element not available";
        }
        x = x[0];

        const file_handler = (data) => {
            if (purpose == "code-python") {
                this.newFile(data);
            }
        };

        setup_drag_n_drop(x, (mime, data) => {
            console.log("upload mime", mime);

            file_handler(data);

            // Close the popup
            w2popup.close();
        }, null, {
            readMode: "text"
        });

        let fuploader = $('#file-select');
        if (fuploader.length == 0) {
            throw "Error: Element not available";
        }
        fuploader = fuploader[0];

        fuploader.style.opacity = 0;

        fuploader.addEventListener("change", x => {
            const file = fuploader.files[0];

            const reader = new FileReader();
            reader.onload = y => {
                file_handler(y.target.result);
                // Close the popup
                w2popup.close();
            };
            reader.readAsText(file);
        });
    }

    getClientID() {
        return this._client_id;
    }

    static hash(data) {
        return btoa(crypto.subtle.digest('SHA-256', Uint8Array.from(data)));
    }


    initEnums() {
        this.getEnum("ScheduleType");
        this.getEnum("StorageType");
        this.getEnum("AccessType");
        this.getEnum("Language");
    }

    // Closes all open windows
    closeAll() {
        if (!this.goldenlayout.root)
            return;
        const comps = this.goldenlayout.root.getItemsByFilter(x => x.config.type == "component");
        comps.forEach((comp) => comp.close());
        this.project().clearClosedWindowsList();
    }

    addContentItem(config) {
        // Remove all saved instances of this component type from the closed windows list
        if (config.componentName) {
            const cw = this.project()._closed_windows;
            this.project().setClosedWindowsList(cw.filter(x => x[0] != config.componentName));
        }

        const root = this.goldenlayout.root;

        // In case goldenlayout was not yet initialized, fail silently
        if (!root)
            return;

        if (root.contentItems.length === 0) {
            // Layout is completely missing, need to add one (row in this case)
            const layout_config = {
                type: 'row',
                content: []
            };
            root.addChild(layout_config);

            // retry with recursion
            this.addContentItem(config);
        } else {
            if (this.goldenlayout.isSubWindow) {
                // Subwindows don't usually have layouts, so send a request that only the main window should answer
                this.goldenlayout.eventHub.emit('create-window-in-main', JSON.stringify(config));
            } else {
                for (const ci of root.contentItems) {
                    if (ci.config.type != "stack") {
                        ci.addChild(config);
                        return;
                    }

                }
                const copy = root.contentItems[0].contentItems.map(x => x.config);
                root.contentItems[0].remove();
                // retry with recursion
                for (const ci of copy) {
                    this.addContentItem(ci);
                }
                this.addContentItem(config);
                //root.contentItems[0].addChild(config);
            }
        }
    }

    newFile(content = "") {
        // Reset project state
        this.closeAll();
        this.createNewProject();

        const millis = this.getPseudorandom();

        // Assuming SDFG files start with {
        if (content[0] == '{') {
            // Prettify JSON object, if not pretty
            if (content.split('\n').length == 1)
                content = JSON.stringify(JSON.parse(content), null, 2);
        }


        const config = {
            title: "Source Code",
            type: 'component',
            componentName: 'CodeInComponent',
            componentState: { created: millis, code_content: content }
        };

        this.addContentItem(config);

        // Compile automatically after loading
        this.gatherProjectElementsAndCompile(this, {}, { sdfg_over_code: true });
    }

    open_diode_settings() {
        const millis = this.getPseudorandom();

        const config = {
            title: "Settings",
            type: 'component',
            componentName: 'SettingsComponent',
            componentState: { created: millis }
        };

        this.addContentItem(config);
    }

    open_runqueue() {
        const millis = this.getPseudorandom();

        const config = {
            title: "Run Queue",
            type: 'component',
            componentName: 'RunqueueComponent',
            componentState: { created: millis }
        };

        this.addContentItem(config);
    }

    getEnum(name) {
        const cached = localStorage.getItem('Enumeration:' + name);
        if (cached == null || cached == undefined) {
            // Request the enumeration from the server

            REST_request("/dace/api/v1.0/getEnum/" + name, undefined, xhr => {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    console.log(name, xhr.response);
                    const tmp = JSON.parse(xhr.response);
                    if (name == "Language") {
                        tmp.enum.push("NoCode");
                    }
                    localStorage.setItem('Enumeration:' + name, JSON.stringify(tmp));
                }
            }, 'GET');

            return null;
        }

        return JSON.parse(cached)['enum'];
    }

    renderProperties(transthis, node, params, parent, options = undefined) {
        /*
            Creates property visualizations in a 2-column table.
        */
        if (params == null) {
            console.warn("renderProperties as nothing to render");
            return;
        }
        if (!Array.isArray(params)) {
            const realparams = params;

            // Format is different (diode to_json with seperate meta / value - fix before passing to renderer)
            let params_keys = Object.keys(params).filter(x => !x.startsWith('_meta_'));
            params_keys = params_keys.filter(x => Object.keys(params).includes('_meta_' + x));

            const _lst = params_keys.map(x => {
                const mx = JSON.parse(JSON.stringify(params['_meta_' + x]));

                mx.name = x;
                mx.value = params[x];

                return { property: mx, category: mx.category, element: realparams, data: node.data };
            });

            params = _lst;
        }

        if (typeof (transthis) == 'string') {
            // Event-based
            const target_name = transthis;
            transthis = {
                propertyChanged: (element, name, value) => {
                    // Modify in SDFG object first
                    this.project().request(['property-changed-' + target_name], x => {

                    }, {
                        timeout: 200,
                        params: {
                            element: element,
                            name: name,
                            value: value,
                            type: options ? options.type : options
                        }
                    });

                    // No need to refresh SDFG if transformation
                    if (options && options.type === 'transformation')
                        return;

                    this.refreshSDFG();
                },
                applyTransformation: () => {
                    this.project().request(['apply-adv-transformation-' + target_name], x => {

                    }, {
                        timeout: 200,
                        params: options == undefined ? undefined : options.apply_params
                    })
                },
                locateTransformation: (opt_name, opt_pos, affects) => {
                    this.project().request(['locate-transformation-' + options.sdfg_name], x => {

                    }, {
                        timeout: 200,
                        params: JSON.stringify([opt_name, opt_pos, affects]),
                    })
                },
                project: () => this.project()
            };
        }
        const dt = new DiodeTables.Table();
        let cur_dt = dt;

        let dtc = null;
        const categories = {};
        for (const x of params) {

            const cat = x.category;
            if (categories[cat] == undefined) {
                categories[cat] = [];
            }
            categories[cat].push(x);
        }
        if (!DIODE.debugDevMode()) {
            delete categories["(Debug)"]
        }
        for (const z of Object.entries(categories)) {

            // Sort within category
            const cat_name = z[0];
            const y = z[1].sort((a, b) => a.property.name.localeCompare(b.property.name));


            // Add Category header
            cur_dt = dt;
            const sp = document.createElement('span');
            sp.innerText = cat_name;
            const tr = cur_dt.addRow(sp);
            tr.childNodes[0].colSpan = "2";

            dtc = new DiodeTables.TableCategory(cur_dt, tr);

            for (const propx of y) {
                const title_part = document.createElement("span");
                const x = propx.property;
                title_part.innerText = x.name;
                title_part.title = x.desc;
                const value_part = diode.getMatchingInput(transthis, x, propx);
                const cr = cur_dt.addRow(title_part, value_part);
                if (dtc != null) {
                    dtc.addContentRow(cr);
                }
            }
        }
        dt.setCSSClass("diode_property_table");

        if (options && options.type == "transformation") {
            // Append a title
            const title = document.createElement("span");
            title.classList = "";
            title.innerText = options.opt_name;
            parent.appendChild(title);

            // Append a "locate" button
            const locate_button = document.createElement("span");
            locate_button.innerText = "location_on";
            locate_button.classList = "material-icons";
            locate_button.style = "cursor: pointer;";

            locate_button.addEventListener("click", () => {
                // Highlight the affected elements (both transformation and nodes)
                transthis.locateTransformation(options.opt_name, options.pos, options.apply_params[0].affects);
            });
            parent.appendChild(locate_button);
        }
        dt.createIn(parent);
        if (options && options.type == "transformation") {
            // Append an 'apply-transformation' button
            const button = document.createElement('button');
            button.innerText = "Apply advanced transformation";
            button.addEventListener('click', _x => {
                button.disabled = true;
                this.project().request(['apply-adv-transformation-' + options.sdfg_name], _y => {
                }, {
                    params: JSON.stringify(options.apply_params)
                });
            });
            parent.appendChild(button);

        }
    }

    create_visual_access_representation(elems, data) {

        const __access_indices = elems[0];
        const __ranges = elems[1];
        const __user_input = elems[2];
        const __additional_defines = {};

        // Add standard functions
        __additional_defines['Min'] = "(...x) => Math.min(...x)";
        __additional_defines['int_ceil'] = "(a,b) => Math.ceil(a/b)";

        for (const x of __user_input) {
            const _r = window.prompt("Enter a value for symbol " + x);
            if (_r != null) {

                // Write the value 
                __additional_defines[x] = _r;
            } else {
                // Aborted
                break;
            }
        }

        // Read the data object properties
        console.log("data", data);
        if (data.type != "Array") {
            console.warn("Non-Array accessed", data);
            // #TODO: What to do here?
        }
        let __mem_dims = data.attributes.shape;
        console.assert(__mem_dims != undefined);
        // Try to eval the functions
        const __eval_func = () => {
            const __defs = Object.keys(__additional_defines).map(x => "let " + x + " = " + __additional_defines[x]).join(";") + ";";
            __mem_dims = __mem_dims.map(x => eval(__defs + x));
        };
        __eval_func();


        const __tbl_container = document.createElement("div");
        const __tbl_hor = document.createElement("div");
        __tbl_hor.classList = "flex_row";
        __tbl_hor.style = "flex-wrap: nowrap; justify-content: flex-start;";
        const __axis_x_info = document.createElement("div");
        {
            __axis_x_info.classList = "flex_row";
            __axis_x_info.style = "justify-content: space-between;";


            for (let __i = 0; __i < 2; ++__i) {
                const __tmp = document.createElement("div");
                // Take the second dimension
                try {
                    __tmp.innerText = (__i == 0) ? "0" : __mem_dims[1];
                } catch (__e) {
                    __tmp.innerText = (__i == 0) ? "Start" : "End";
                }
                __axis_x_info.appendChild(__tmp);
            }
        }

        const __axis_y_info = document.createElement("div");
        {
            __axis_y_info.classList = "flex_column";
            __axis_y_info.style = "justify-content: space-between;";


            for (let __i = 0; __i < 2; ++__i) {
                const __tmp = document.createElement("div");
                // Take the first dimension
                try {
                    __tmp.innerText = (__i == 0) ? "0" : __mem_dims[0];
                } catch (__e) {
                    __tmp.innerText = (__i == 0) ? "Start" : "End";
                }
                __axis_y_info.appendChild(__tmp);
            }
        }

        const __tbl_vert = document.createElement("div");
        __tbl_vert.classList = "flex_col";
        if (data != null) {
            __tbl_vert.appendChild(__axis_x_info);
            __tbl_hor.appendChild(__axis_y_info);
        }
        // Now create a table with the according cells for this
        let __size = 10;
        if (__mem_dims.some(x => x > 128)) __size = 5;

        if (__mem_dims.length < 2) __mem_dims.push(1); // Force at least 2 dimensions (2nd dim size is trivial: 1)

        console.log("access indices", __access_indices);
        console.log("ranges", __ranges);

        // This is very limited; future work can take place here
        // The current implementation works only by fixing all but one range per dimension.
        // This is done for 2 main reasons:
        // 1) Performance. It is not possible to determine the access patterns in O(n) without either using an LSE
        //        with range side conditions (which is hard to solve in "naked" JS). The only alternative is to actually
        //        scan __all__ possible values, which is infeasible on a browser client.
        // 2) Visual Cluttering. Seeing too much at once is not helpful. Implementing an easy-to-use UI solving this problem
        //        is beyond the scope of the initial PoC.

        // Obtain fixed ranges (all but smallest)
        const __fixed_rngs = __ranges.map(x => x).sort((a, b) => a.depth - b.depth).slice(1).reverse();
        // Get the variable range (smallest)
        const __var_rng = __ranges[0];

        const __rng_inputs = [];

        let __create_func = () => null;

        const __main = x => x.main != undefined ? x.main : x;
        // Add inputs for every fixed range
        {
            const input_cont = document.createElement("div");
            let __defs = Object.keys(__additional_defines).map(x => "let " + x + " = " + __additional_defines[x]).join(";") + ";";

            const __global_slider = document.createElement("input");
            {
                __global_slider.type = "range";
                __global_slider.min = "0";
                __global_slider.value = "0";
                __global_slider.step = "1";

                input_cont.appendChild(__global_slider);
            }

            let __total_rng_count = 1;
            let __locked_range = false;

            input_cont.classList = "flex_column";
            for (const __r of __fixed_rngs) {
                const _lbl = document.createElement("label");
                const _in = document.createElement("input");
                _in.type = "number";
                _in.min = "0";
                _in.step = "1";

                _in.addEventListener("change", _click => {
                    // Trigger update

                    // Move the slider position
                    let __spos = 0;
                    let __base = 1;
                    for (const __r of __rng_inputs.map(x => x).reverse()) {
                        const __s = parseInt(__r.max) - parseInt(__r.min) + 1;

                        const __v = __r.value;

                        __spos += parseInt(__v) * __base;
                        __base *= parseInt(__s);
                    }
                    __global_slider.value = __spos;

                    __create_func();
                });
                // Set limits
                try {
                    _in.min = eval(__defs + __main(__r.val.start));
                } catch (e) {
                    console.warn("Got error when resolving expression");
                }
                try {
                    _in.max = eval(__defs + __main(__r.val.end));
                } catch (e) {
                    console.warn("Got error when resolving expression");
                }
                try {
                    _in.value = eval(__defs + __main(__r.val.start));
                } catch (e) {
                    console.warn("Got error when resolving expression");
                }

                // Add the starting value as an expression to defs
                __defs += "let " + __r.var + " = " + __main(__r.val.start) + ";";

                _lbl.innerText = "Range iterator " + __r.var + " over [" + __main(__r.val.start) + ", " + __main(__r.val.end) + "] in steps of " + __main(__r.val.step);
                _in.setAttribute("data-rname", __r.var);
                _lbl.appendChild(_in);
                __rng_inputs.push(_in);

                input_cont.appendChild(_lbl);

                if (__total_rng_count == 0) __total_rng_count = 1;

                const __e_size = ((__x) => eval(__defs + "(" + __main(__x.val.end) + " - " + __main(__x.val.start) + "+1) / " + __main(__x.val.step)))(__r);
                if (__e_size == 0 || __locked_range) {
                    __locked_range = true;
                } else {
                    __total_rng_count *= __e_size;
                }
            }
            console.log("__total_rng_count", __total_rng_count);
            {
                __global_slider.max = __total_rng_count - 1; // Inclusive range

                __global_slider.addEventListener("input", __ev => {
                    let __v = parseInt(__global_slider.value);

                    for (const __r of __rng_inputs.map(x => x).reverse()) {
                        const __s = parseInt(__r.max) - parseInt(__r.min) + 1;

                        const __subval = __v % __s;

                        __r.value = __subval;

                        __v = Math.floor(__v / __s);
                    }
                });

                const r = __var_rng;
                const _lbl = document.createElement("label");
                const _in = document.createElement("span");

                __global_slider.addEventListener("input", _ev => {
                    __create_func();
                });

                _in.innerText = "(whole range)";
                _lbl.innerText = "Range iterator " + r.var + " over [" + __main(r.val.start) + ", " + __main(r.val.end) + "] in steps of " + __main(r.val.step);
                _lbl.appendChild(_in);

                input_cont.appendChild(_lbl);
            }
            __tbl_container.appendChild(input_cont);
        }

        __create_func = () => {
            __tbl_vert.innerHTML = "";
            __tbl_vert.appendChild(__axis_x_info);
            const __all_fixed = {};
            Object.assign(__all_fixed, __additional_defines);
            // Get the fixed values
            {
                for (const i of __rng_inputs) {
                    const rname = i.getAttribute("data-rname");
                    const val = i.value;

                    __all_fixed[rname] = val;
                }
            }

            const __defstring = Object.keys(__all_fixed).map(x => "let " + x + " = " + __all_fixed[x] + ";").join("");

            const __ellision_thresh_y = 64;
            const __ellision_thresh_x = 128;

            const __mark_cells = {};

            // Evaluate the range
            {
                const feval = (x) => {
                    return eval(__defstring + x);
                };
                const __it = __var_rng.var;
                const __r_s = __main(__var_rng.val.start);
                const __r_e = __main(__var_rng.val.end);
                const __r_step = __main(__var_rng.val.step);

                // Remember: Inclusive ranges
                for (let __x = feval(__r_s); __x <= feval(__r_e); __x += feval(__r_step)) {
                    // Add this to the full evaluation
                    let __a_i = __access_indices.map((x, i) => [x, i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);


                    __a_i = __a_i.map(__y => feval("let " + __it + " = " + __x + ";" + __y.var));

                    const __tmp = __mark_cells[__a_i[1]];
                    if (__tmp == undefined) {
                        __mark_cells[__a_i[1]] = [];
                    }
                    __mark_cells[__a_i[1]].push(__a_i[0]);
                }
            }

            for (let __dim_2 = 0; __dim_2 < __mem_dims[0]; ++__dim_2) {

                // Check ellision
                if (__mem_dims[0] > __ellision_thresh_y && __dim_2 > __ellision_thresh_y / 2 && __dim_2 < __mem_dims[0] - __ellision_thresh_y / 2) {
                    // Elide
                    if (__dim_2 - 1 == __ellision_thresh_y / 2) {
                        // Add ellision info _once_
                        const __row = document.createElement("div");
                        __row.classList = "flex_row";
                        __row.style = "justify-content: flex-start;flex-wrap: nowrap;"
                        __row.innerText = "...";
                        __tbl_vert.appendChild(__row);
                    }
                    continue;
                }
                const __row = document.createElement("div");
                __row.classList = "flex_row";
                __row.style = "justify-content: flex-start;flex-wrap: nowrap;"

                for (let __i = 0; __i < __mem_dims[1]; ++__i) {
                    // Check ellision
                    if (__mem_dims[1] > __ellision_thresh_x && __i > __ellision_thresh_x / 2 && __i < __mem_dims[1] - __ellision_thresh_x / 2) {
                        // Elide
                        if (__i - 1 == __ellision_thresh_x / 2) {
                            // Add ellision info _once_
                            const __cell = document.createElement('div');
                            __cell.style = "line-height: 1px;";
                            //let __colorstr = "background: white;";
                            //__cell.style = "min-width: " + __size + "px; min-height: " + __size + "px;border: 1px solid black;" + __colorstr;
                            __cell.innerText = "...";
                            __row.appendChild(__cell);
                        }
                        continue;
                    }

                    let __set_marking = false;
                    {
                        const __tmp = __mark_cells[__dim_2];
                        if (__tmp != undefined) {
                            if (__tmp.includes(__i)) __set_marking = true;
                        }
                    }

                    const __cell = document.createElement('div');
                    let __colorstr = "background: white;";
                    if (__set_marking) {
                        __colorstr = "background: red;";
                    }

                    __cell.style = "min-width: " + __size + "px; min-height: " + __size + "px;border: 1px solid darkgray;" + __colorstr;
                    __row.appendChild(__cell);
                }

                __tbl_vert.appendChild(__row);
            }
            __tbl_hor.appendChild(__tbl_vert);
        };
        __tbl_container.appendChild(__tbl_hor);

        __create_func();

        return __tbl_container;
    }

    create_visual_range_representation(__starts, __ends, __steps, __tiles, __mayfail = true, __data = null) {
        const __obj_to_arr = x => (x instanceof Array) ? x : [x];

        __starts = __obj_to_arr(__starts);
        __ends = __obj_to_arr(__ends);
        __steps = __obj_to_arr(__steps);
        __tiles = __obj_to_arr(__tiles);

        // NOTE: This context is eval()'d. This means that all variables must be in the forbidden namespace (__*) or they might be erroneously evaluated.
        const __symbols = {};

        const __e_starts = [];
        const __e_ends = [];
        const __e_steps = [];
        const __e_tiles = [];
        const __e_sizes = [];

        for (let __r_it = 0; __r_it < __starts.length; ++__r_it) {

            const __start = __starts[__r_it];
            const __end = __ends[__r_it];
            const __step = __steps[__r_it];
            const __tile = __tiles[__r_it];

            let __e_start = null;
            let __e_end = null;
            let __e_step = null;
            let __e_tile = null;

            let __mem_dims = [];
            while (true) {
                let __failed = false;
                const __symbol_setter = Object.entries(__symbols).map(x => "let " + x[0] + "=" + x[1] + ";").join("");
                try {
                    // Define a couple of dace-functions that are used here
                    const Min = (...x) => Math.min(...x);
                    const int_ceil = (a, b) => Math.ceil(a / b);

                    __e_start = eval(__symbol_setter + __start);
                    __e_end = eval(__symbol_setter + __end) + 1; // The DaCe ranges are inclusive - we want to exclusive here.
                    __e_step = eval(__symbol_setter + __step);
                    __e_tile = eval(__symbol_setter + __tile);

                    if (__data != null) {
                        const __shapedims = __data.attributes.shape.length;
                        __mem_dims = [];
                        for (let __s = 0; __s < __shapedims; ++__s) {
                            __mem_dims.push(eval(__symbol_setter + __data.attributes.shape[__s]));
                        }
                    }
                } catch (e) {
                    if (e instanceof ReferenceError) {
                        // Expected, let the user provide inputs
                        if (__mayfail) {
                            __failed = true;
                            break;
                        } else {
                            // Prompt the user and retry
                            const __sym_name = e.message.split(" ")[0];
                            const __ret = window.prompt("Enter a value for Symbol `" + __sym_name + "`");
                            if (__ret == null) throw e;
                            __symbols[__sym_name] = parseInt(__ret);
                            __failed = true;
                        }
                    } else {
                        // Unexpected error, rethrow
                        throw e;
                    }
                }
                if (!__failed) {
                    break;
                }
            }

            const __e_size = __e_end - __e_start;

            __e_starts.push(__e_start);
            __e_ends.push(__e_end);
            __e_steps.push(__e_step);
            __e_tiles.push(__e_tile);
            __e_sizes.push(__e_size);
        }

        const __tbl_container = document.createElement("div");
        const __tbl_hor = document.createElement("div");
        __tbl_hor.classList = "flex_row";
        __tbl_hor.style = "flex-wrap: nowrap;";
        const __axis_x_info = document.createElement("div");
        {
            __axis_x_info.classList = "flex_row";
            __axis_x_info.style = "justify-content: space-between;";


            for (let __i = 0; __i < 2; ++__i) {
                const __tmp = document.createElement("div");
                // Take the second dimension
                try {
                    __tmp.innerText = (__i == 0) ? "0" : __mem_dims[1];
                } catch (__e) {
                    __tmp.innerText = (__i == 0) ? "Start" : "End";
                }
                __axis_x_info.appendChild(__tmp);
            }
        }

        const __axis_y_info = document.createElement("div");
        {
            __axis_y_info.classList = "flex_column";
            __axis_y_info.style = "justify-content: space-between;";


            for (let __i = 0; __i < 2; ++__i) {
                const __tmp = document.createElement("div");
                // Take the first dimension
                try {
                    __tmp.innerText = (__i == 0) ? "0" : __mem_dims[0];
                } catch (__e) {
                    __tmp.innerText = (__i == 0) ? "Start" : "End";
                }
                __axis_y_info.appendChild(__tmp);
            }
        }

        if (__data != null) {
            __tbl_container.appendChild(__axis_x_info);
            __tbl_hor.appendChild(__axis_y_info);
        }
        // Now create a table with the according cells for this
        // Since this is done on a per-dimension basis, the table only has to be 1D, so we use a flexbox for this (easier)
        const __row = document.createElement("div");
        __row.classList = "flex_row";
        __row.style = "justify-content: flex-start;flex-wrap: nowrap;"

        let __size = 10;
        const __e_size = __e_sizes[0]; // #TODO: Adapt for multi-dim ranges if those are requested
        const __e_step = __e_steps[0];
        const __e_tile = __e_tiles[0];

        if (__e_size > 512) __size = 5;

        for (let __i = 0; __i < __e_size; ++__i) {
            const __cell = document.createElement('div');
            let __colorstr = "background: white;";
            if (Math.floor(__i / __e_step) % 2 == 0) {
                if (__i % __e_step < __e_tile) {
                    __colorstr = "background: SpringGreen;";
                }
            } else {
                if (__i % __e_step < __e_tile) {
                    __colorstr = "background: Darkorange;";
                }
            }
            __cell.style = "min-width: " + __size + "px; min-height: " + __size + "px;border: 1px solid black;" + __colorstr;
            __row.appendChild(__cell);
        }

        __tbl_hor.appendChild(__row);
        __tbl_container.appendChild(__tbl_hor);
        return __tbl_container;
    }

    getMatchingInput(transthis, x, node) {

        const create_language_input = (value, onchange) => {
            if (value == undefined) {
                value = x.value;
            }
            if (onchange == undefined) {
                onchange = (elem) => {
                    transthis.propertyChanged(node, x.name, elem.value);
                };
            }
            const language_types = this.getEnum('Language');
            let qualified = value;
            if (!language_types.includes(qualified)) {
                qualified = "Language." + qualified;
            }
            const elem = FormBuilder.createSelectInput("prop_" + x.name, onchange, language_types, qualified);
            return elem;
        };

        const __resolve_initials = (__initials, __syms) => {
            "use strict";
            delete window.i; // Whoever thought it was a good idea to define a global variable named 'i'...
            // We have to operate in the forbidden namespace (__*)

            // Filter out all constants first
            __initials = __initials.filter(x => isNaN(x.var));

            // Add a merger function
            const __merger = (a, b) => {
                const acpy = a.map(x => x);
                for (const y of b) {
                    if (acpy.filter(x => (x == y) || (x.var != undefined && (JSON.stringify(x.var) == JSON.stringify(y.var)))).length > 0) {
                        continue;
                    } else {
                        acpy.push(y);
                    }
                }
                return acpy;
            };

            let __needed_defs = [];
            const __placeholder_defines = [];
            let __user_input_needed = [];
            while (true) {
                let __retry = false;
                let __placeholder_def_str = __placeholder_defines.map(x => "let " + x + " = 1").join(";");
                // Inject the known functions as well
                __placeholder_def_str += ";let Min = (...e) => Math.min(...e); let int_ceil = (a, b) => Math.ceil(a/b);"
                for (const __i of __initials) {
                    // For every initial, find the first defining element (element with the same name that assigns an expression)
                    try {
                        const __test = eval(__placeholder_def_str + __i.var);
                    } catch (e) {
                        if (e instanceof ReferenceError) {
                            const __sym_name = e.message.split(" ")[0];
                            const __defs = __syms.filter(x => x.var == __sym_name && x.val != null);
                            if (__defs.length > 0) {
                                // Found a matching definition
                                __placeholder_defines.push(__sym_name);
                                __needed_defs = __merger(__needed_defs, [__defs[0]]);

                                let __j = 0;
                                for (; __j < __syms.length; ++__j) {
                                    if (JSON.stringify(__syms[__j]) == JSON.stringify(__defs[0])) {
                                        break;
                                    }
                                }
                                const __f = x => x.main != undefined ? x.main : x;

                                // Recurse into range subelements (if applicable)
                                if (__defs[0].val != null && __defs[0].val.start != undefined) {
                                    // find the starting node

                                    let __tmp = __resolve_initials([{
                                        var: __f(__defs[0].val.start),
                                        val: null
                                    }], __syms.slice(__j));
                                    __needed_defs = __merger(__needed_defs, __tmp[1]);
                                    __user_input_needed = __merger(__user_input_needed, __tmp[2]);
                                    __tmp = __resolve_initials([{
                                        var: __f(__defs[0].val.end),
                                        val: null
                                    }], __syms.slice(__j));
                                    __needed_defs = __merger(__needed_defs, __tmp[1]);
                                    __user_input_needed = __merger(__user_input_needed, __tmp[2]);
                                    __tmp = __resolve_initials([{
                                        var: __f(__defs[0].val.step),
                                        val: null
                                    }], __syms.slice(__j));
                                    __needed_defs = __merger(__needed_defs, __tmp[1]);
                                    __user_input_needed = __merger(__user_input_needed, __tmp[2]);
                                    __tmp = __resolve_initials([{
                                        var: __f(__defs[0].val.tile),
                                        val: null
                                    }], __syms.slice(__j));
                                    __needed_defs = __merger(__needed_defs, __tmp[1]);
                                    __user_input_needed = __merger(__user_input_needed, __tmp[2]);
                                } else {
                                    // Recurse into the found value.
                                    const __tmp = __resolve_initials([{
                                        var: __f(__defs[0].val),
                                        val: null
                                    }], __syms.slice(__j));
                                    console.log("rec", __tmp);
                                    // Add elements to lists
                                    __needed_defs = __merger(__needed_defs, __tmp[1]);
                                    __user_input_needed = __merger(__user_input_needed, __tmp[2]);
                                }
                            } else {
                                // Need user input for this Symbol (defer actually requesting that info from the user)
                                __user_input_needed.push(__sym_name);
                                // Also promise to define the symbol later
                                __placeholder_defines.push(__sym_name);
                            }
                            __retry = true;
                            break;
                        } else {
                            // Rethrow unknown exceptions
                            throw e;
                        }
                    }
                    if (__retry) break;
                }
                if (__retry) continue;


                break;
            }
            // Return a (cleaned) list of the required elements
            return [__initials, __needed_defs, __user_input_needed];
        };

        const create_index_subset_input = (transthis, x, node) => {
            // Similar to range, but actually binding values
            // This therefore occurs in memlets inside Maps mostly
            // (Except when accessing using constants)

            // Because the indices are used to access data (arrays),
            // there needs to be lookup by finding the parent nodes (potentially using connectors).
            // A lookup may traverse to top-level and throw if the symbols are not resolved yet.

            const cont = document.createElement("div");

            if (node.data === undefined)
                return $(cont);


            const indices = x.value.indices;

            // Generate string from indices
            let preview = '[';
            for (const index of indices) {
                preview += index + ', ';
            }
            preview = preview.slice(0, -2) + ']';

            cont.innerText = preview + '  ';

            const elem = document.createElement("button");
            elem.style.float = "right";
            elem.innerText = "Edit";
            cont.appendChild(elem);

            elem.addEventListener("click", (_click) => {
                this.project().request(['sdfg_object'], resp => {
                    const tmp = resp['sdfg_object'];
                    let syms = [];
                    for (const v of Object.values(tmp)) {
                        const tsyms = SDFG_Parser.lookup_symbols(v, node.state_id, node.node_id, null);
                        syms = [...syms, ...tsyms];
                        console.log("syms", syms);

                        // Got the symbols, now resolve.

                        // Resolve (ltr is inner-to-outer)
                    }
                    // Rationale here: Render the underlying data as a basis,
                    // then use index and range information to find access patterns

                    // Find the initial values
                    const initials = [];
                    for (const x of syms) {
                        if (x.val != null) break;
                        initials.push(x);
                    }
                    // initials contains the indices used. Resolve all ranges defining those

                    const newelems = __resolve_initials(initials, syms);
                    console.log("newelems", newelems);

                    let data = node.data().props.filter(x => x.name == "data")[0];

                    let data_objs = [];
                    for (const x of Object.values(tmp)) {
                        data_objs.push(x.attributes._arrays[data.value]);
                    }
                    data_objs = data_objs.filter(x => x != undefined);
                    if (data_objs.length > 0) {
                        data = data_objs[0];
                    }

                    const popup_div = document.createElement('div');

                    const popup_div_body = document.createElement('div');

                    const value_input = document.createElement("input");
                    value_input.type = "text";
                    value_input.value = JSON.stringify(x.value);

                    const e = this.create_visual_access_representation(
                        newelems, data
                    );

                    const apply_but = document.createElement("button");
                    apply_but.innerText = "Apply changes";
                    apply_but.addEventListener("click", _click => {
                        transthis.propertyChanged(node, x.name, JSON.parse(value_input.value));
                        w2popup.close();
                    });
                    popup_div_body.appendChild(value_input);

                    popup_div_body.appendChild(e);
                    popup_div.appendChild(popup_div_body);

                    w2popup.open({
                        title: "Data access / Indices property",
                        body: popup_div,
                        buttons: apply_but,
                        width: 1280,
                        height: 800,
                    });
                }, {});
            });

            return $(cont);
        }

        const create_range_input = (transthis, x, node) => {

            // As ranges _usually_ operate on data, check if a property named "data" is in the same object.
            // If it is, we can inform the design of visualizations with the shape of the data object (array)
            // #TODO: Always update this when changed (in the current implementation, it is possible that stale values are read for different properties)
            let data_obj = null;
            if (node.data != undefined) {
                const tmp = node.data().props.filter(x => x.name == "data");
                if (tmp.length > 0) {
                    // Found data (name only, will resolve when rendering is actually requested)
                    data_obj = tmp[0];
                }
            }


            const cont = document.createElement("div");

            const ranges = x.value.ranges;
            const popup_div = document.createElement('div');

            // Generate string from range
            let preview = '[';
            for (const range of ranges) {
                preview += range.start + '..' + range.end;
                if (range.step != 1) {
                    preview += ':' + range.step;
                    if (range.tile != 1)
                        preview += ':' + range.tile;
                } else if (range.tile != 1) {
                    preview += '::' + range.tile;
                }
                preview += ', ';
            }
            preview = preview.slice(0, -2) + ']';

            cont.innerText = preview + '  ';

            const elem = document.createElement("button");
            elem.style.float = "right";
            elem.innerText = "Edit";
            cont.appendChild(elem);


            const popup_div_body = document.createElement('div');


            const range_elems = [];
            for (const r of ranges) {
                // Add a row for every range
                const r_row = document.createElement('div');
                r_row.classList = "flex_row";
                r_row.style = "flex-wrap: nowrap;";
                if (typeof (r.start) != 'string') r.start = r.start.main;
                if (typeof (r.end) != 'string') r.end = r.end.main;
                if (typeof (r.step) != 'string') r.step = r.step.main;
                if (typeof (r.tile) != 'string') r.tile = r.tile.main;

                {
                    const input_refs = [];
                    // Generate 4 text inputs and add them to the row
                    for (let i = 0; i < 4; ++i) {
                        // Generate the label first
                        const lbl = document.createElement('label');
                        const ti = document.createElement('input');
                        ti.style = "width:100px;";
                        ti.type = "text";
                        switch (i) {
                            case 0:
                                ti.value = r.start;
                                lbl.textContent = "Start";
                                break;
                            case 1:
                                ti.value = r.end;
                                lbl.textContent = "End";
                                break;
                            case 2:
                                ti.value = r.step;
                                lbl.textContent = "Step";
                                break;
                            case 3:
                                ti.value = r.tile;
                                lbl.textContent = "Tile";
                                break;
                        }
                        input_refs.push(ti);
                        lbl.appendChild(ti);
                        r_row.appendChild(lbl);
                    }
                    range_elems.push(input_refs);
                    const visbut = document.createElement('div');
                    visbut.style = "min-width: 200px; min-height: 1rem;flex-grow: 1;display: flex;";
                    visbut.addEventListener('click', () => {

                        // Resolve the data name and set the object accordingly
                        if (data_obj != null) {

                            this.project().request(['sdfg_object'], sdfg_obj => {
                                if (typeof sdfg_obj.sdfg_object === 'object')
                                    sdfg_obj = sdfg_obj.sdfg_object;
                                else
                                    sdfg_obj = JSON.parse(sdfg_obj.sdfg_object);
                                console.log("got sdfg object", sdfg_obj);
                                // Iterate over all SDFGs, checking arrays and returning matching data elements

                                let data_objs = [];
                                for (const x of Object.values(sdfg_obj)) {
                                    data_objs.push(x.attributes._arrays[data_obj.value]);
                                }
                                data_objs = data_objs.filter(x => x != undefined);
                                if (data_objs.length > 0) {
                                    data_obj = data_objs[0];
                                }

                                const vis_elem = this.create_visual_range_representation(...input_refs.map(x => x.value), false, data_obj);
                                visbut.innerHTML = "";
                                visbut.appendChild(vis_elem);
                            }, {});

                        } else {
                            const vis_elem = this.create_visual_range_representation(...input_refs.map(x => x.value), false, data_obj);
                            visbut.innerHTML = "";
                            visbut.appendChild(vis_elem);
                        }

                    });
                    visbut.innerText = "Click here for visual representation";
                    r_row.appendChild(visbut);
                }


                popup_div_body.appendChild(r_row);
            }

            popup_div.appendChild(popup_div_body);

            const apply_but = document.createElement("button");
            apply_but.innerText = "Apply";
            apply_but.addEventListener("click", () => {
                const ret = {
                    ranges: [],
                    type: x.value.type,
                }
                for (const re of range_elems) {
                    ret.ranges.push({
                        start: re[0].value,
                        end: re[1].value,
                        step: re[2].value,
                        tile: re[3].value
                    })
                }
                transthis.propertyChanged(node, x.name, ret);
                w2popup.close();
            });

            elem.onclick = () => {
                w2popup.open({
                    title: "Range property",
                    body: popup_div,
                    buttons: apply_but,
                    width: 1280,
                    height: 800,
                });
            };
            return $(cont);
        };

        // TODO: Handle enumeration types better
        let elem = document.createElement('div');
        if (x.metatype == "bool") {
            let val = x.value;
            if (typeof (val) == 'string') val = val == 'True';
            elem = FormBuilder.createToggleSwitch("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.checked);

            }, val);
        } else if (
            x.metatype == "str" || x.metatype == "float" || x.metatype == "LambdaProperty" || x.metatype == "Property"
        ) {
            elem = FormBuilder.createTextInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, x.value);
        } else if (
            x.metatype == "tuple" || x.metatype == "dict" ||
            x.metatype == "list" || x.metatype == "set"
        ) {
            elem = FormBuilder.createTextInput("prop_" + x.name, (elem) => {
                let tmp = elem.value;
                try {
                    tmp = JSON.parse(elem.value);
                } catch (e) {
                    tmp = elem.value;
                }
                transthis.propertyChanged(node, x.name, tmp);
            }, JSON.stringify(x.value));
        } else if (x.metatype == "Range") {
            elem = create_range_input(transthis, x, node);
        } else if (x.metatype == "DataProperty") {
            // The data list has to be fetched from the SDFG.
            // Therefore, there needs to be a placeholder until data is ready
            elem = document.createElement("span");
            elem.innerText = x.value;

            elem = $(elem);
            const cb = d => {
                // Only show data for the inner SDFG (it's possible to input an arbitrary string, still)
                const sdfg = node.sdfg;
                const arrays = sdfg.attributes._arrays;
                const array_names = Object.keys(arrays);

                const new_elem = FormBuilder.createComboboxInput("prop_" + x.name, (elem) => {
                    transthis.propertyChanged(node, x.name, elem.value);
                }, array_names, x.value);

                // Replace the placeholder
                elem[0].parentNode.replaceChild(new_elem[0], elem[0]);
            };
            this.project().request(['sdfg_object'], cb, {
                on_timeout: cb,
                timeout: 300
            });

        } else if (x.metatype == "LibraryImplementationProperty") {
            // The list of implementations has to be fetched from
            // the server directly.
            elem = document.createElement("span");
            elem.innerText = x.value;

            elem = $(elem);
            $.getJSON("/dace/api/v1.0/getLibImpl/" + node.element.classpath, available_implementations => {
                const cb = d => {
                    const new_elem = FormBuilder.createComboboxInput("prop_" + x.name, (elem) => {
                        transthis.propertyChanged(node, x.name, elem.value);
                    }, available_implementations, x.value);

                    // Add Expand button to transform the node
                    const button = FormBuilder.createButton("prop_" + x.name + "_expand",
                        (elem) => {

                            // Expand library node
                            REST_request("/dace/api/v1.0/expand/", {
                                sdfg: node.sdfg,
                                nodeid: [node.sdfg.sdfg_list_id, node.element.parent_id, node.element.id]
                            }, (xhr) => {
                                if (xhr.readyState === 4 && xhr.status === 200) {
                                    const resp = parse_sdfg(xhr.response);
                                    if (resp.error !== undefined) {
                                        // Propagate error
                                        this.handleErrors(this, resp);
                                    }

                                    // Add to history
                                    this.project().request(["append-history"], x => {
                                    }, {
                                        params: {
                                            new_sdfg: resp.sdfg,
                                            item_name: "Expand " + node.element.label
                                        }
                                    });
                                }
                            });
                        }, "Expand");


                    // Replace the placeholder
                    elem[0].parentNode.replaceChild(new_elem[0], elem[0]);
                    new_elem[0].parentNode.appendChild(button[0]);
                };
                this.project().request(['sdfg_object'], cb, {
                    on_timeout: cb,
                    timeout: 300
                });
            });
        } else if (x.metatype == "CodeProperty" || x.metatype == "CodeBlock") {
            let codeelem = null;
            let langelem = null;
            const onchange = (elem) => {
                transthis.propertyChanged(node, x.name, {
                    'string_data': codeelem[0].value,
                    'language': langelem[0].value
                });
            };
            if (x.value == null) {
                x.value = {};
                x.value.language = "NoCode";
                x.value.string_data = "";
            }
            codeelem = FormBuilder.createLongTextInput("prop_" + x.name, onchange, x.value.string_data);
            elem.appendChild(codeelem[0]);
            langelem = create_language_input(x.value.language, onchange);
            elem.appendChild(langelem[0]);
            elem.classList.add("flex_column");

            return elem;
        } else if (x.metatype == "int") {
            elem = FormBuilder.createIntInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, parseInt(elem.value));
            }, x.value);
        } else if (x.metatype == 'ScheduleType') {
            const schedule_types = this.getEnum('ScheduleType');
            let qualified = x.value;
            if (!schedule_types.includes(qualified)) {
                qualified = "ScheduleType." + qualified;
            }
            elem = FormBuilder.createSelectInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, schedule_types, qualified);
        } else if (x.metatype == 'AllocationLifetime') {
            const types = this.getEnum('AllocationLifetime');
            let qualified = x.value;
            if (!types.includes(qualified)) {
                qualified = "AllocationLifetime." + qualified;
            }
            elem = FormBuilder.createSelectInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, types, qualified);
        } else if (x.metatype == 'AccessType') {
            const access_types = this.getEnum('AccessType');
            let qualified = x.value;
            if (!access_types.includes(qualified)) {
                qualified = "AccessType." + qualified;
            }
            elem = FormBuilder.createSelectInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, access_types, qualified);
        } else if (x.metatype == 'Language') {
            elem = create_language_input();
        } else if (x.metatype == 'None') {
            // Not sure why the user would want to see this
            console.log("Property with type 'None' ignored", x);
            return elem;
        } else if (x.metatype == 'object' && x.name == 'identity') {
            // This is an internal property - ignore
            return elem;
        } else if (x.metatype == 'OrderedDiGraph') {
            // #TODO: What should we do with this?
            elem = FormBuilder.createTextInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, x.value);
        } else if (x.metatype == 'DebugInfo') {
            // Special case: The DebugInfo contains information where this element was defined
            // (in the original source).
            let info_obj = x.value;
            if (typeof (info_obj) == 'string')
                info_obj = JSON.parse(info_obj);
            elem = FormBuilder.createCodeReference("prop_" + x.name, (elem) => {
                // Clicked => highlight the corresponding code
                transthis.project().request(['highlight-code'], msg => {
                }, {
                    params: info_obj
                });
            }, info_obj);
        } else if (x.metatype == 'ListProperty') {
            // #TODO: Find a better type for this
            elem = FormBuilder.createTextInput("prop_" + x.name, (elem) => {
                let tmp = elem.value;
                try {
                    tmp = JSON.parse(elem.value);
                } catch (e) {
                    tmp = elem.value;
                }
                transthis.propertyChanged(node, x.name, tmp);
            }, JSON.stringify(x.value));
        } else if (x.metatype == "StorageType") {
            const storage_types = this.getEnum('StorageType');
            let qualified = x.value;
            if (!storage_types.includes(qualified)) {
                qualified = "StorageType." + qualified;
            }
            elem = FormBuilder.createSelectInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, storage_types, qualified);
        } else if (x.metatype == "InstrumentationType") {
            const storage_types = this.getEnum('InstrumentationType');
            let qualified = x.value;
            if (!storage_types.includes(qualified)) {
                qualified = "InstrumentationType." + qualified;
            }
            elem = FormBuilder.createSelectInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, storage_types, qualified);
        } else if (x.metatype == "typeclass") {
            // #TODO: Type combobox
            elem = FormBuilder.createTextInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, x.value);
        } else if (x.metatype == "hosttype") {
            elem = FormBuilder.createHostInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, DIODE.getHostList(), x.value);
        } else if (x.metatype == "selectinput") {
            elem = FormBuilder.createSelectInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, x.options, x.value);
        } else if (x.metatype == "combobox") {
            elem = FormBuilder.createComboboxInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, elem.value);
            }, x.options, x.value);
        } else if (x.metatype == "font") {
            console.warn("Ignoring property type ", x.metatype);
            return elem;
        } else if (x.metatype == "SDFGReferenceProperty") {
            // Nothing to display
            return elem;
        } else if (x.metatype == "SubsetProperty") {
            if (x.value == null) {
                elem = FormBuilder.createTextInput("prop_" + x.name, (elem) => {
                    transthis.propertyChanged(node, x.name, JSON.parse(elem.value));
                }, JSON.stringify(x.value));
            } else if (x.value.type == "subsets.Indices" || x.value.type == "Indices") {
                elem = create_index_subset_input(transthis, x, node);
            } else {
                elem = create_range_input(transthis, x, node);
            }
        } else if (x.metatype == "SymbolicProperty") {
            elem = FormBuilder.createTextInput("prop_" + x.name, (elem) => {
                transthis.propertyChanged(node, x.name, JSON.parse(elem.value));
            }, JSON.stringify(x.value));
        } else {
            console.log("Unimplemented property type: ", x);
            alert("Unimplemented property type: " + x.metatype);

            return elem;
        }
        return elem[0];
    }

    renderPropertiesInWindow(transthis, node, params, options) {
        const dobj = {
            transthis: typeof (transthis) == 'string' ? transthis : transthis.created,
            node: node,
            params: params,
            options: options
        };
        this.replaceOrCreate(['display-properties'], 'PropWinComponent', dobj,
            () => {
                const millis = this.getPseudorandom();
                const config = {
                    type: 'component',
                    componentName: 'PropWinComponent',
                    componentState: {
                        created: millis,
                        params: dobj
                    }
                };

                this.addContentItem(config);
            });
    }

    showStaleDataButton() {
        this.project().request(['show_stale_data_button'], x => {
        }, {});
    }

    removeStaleDataButton() {
        this.project().request(['remove_stale_data_button'], x => {
        }, {});
    }

    refreshSDFG() {
        this.gatherProjectElementsAndCompile(diode, {}, { sdfg_over_code: true });
    }

    __impl_showStaleDataButton() {
        /*
            Show a hard-to-miss button hinting to recompile.
        */

        if (DIODE.recompileOnPropertyChange()) {
            // Don't show a warning, just recompile directly
            this.gatherProjectElementsAndCompile(this, {}, { sdfg_over_code: true });
            return;
        }
        if (this._stale_data_button != null) {
            return;
        }
        const stale_data_button = document.createElement("div");
        stale_data_button.classList = "stale_data_button";
        stale_data_button.innerHTML = "Stale project data. Click here or press <span class='key_combo'>Alt-R</span> to synchronize";

        stale_data_button.addEventListener('click', x => {
            this.gatherProjectElementsAndCompile(diode, {}, { sdfg_over_code: true });
        })

        document.body.appendChild(stale_data_button);

        this._stale_data_button = stale_data_button;
    }

    __impl_removeStaleDataButton() {
        if (this._stale_data_button != null) {
            const p = this._stale_data_button.parentNode;
            p.removeChild(this._stale_data_button);
            this._stale_data_button = null;
        }
    }


    showIndeterminateLoading() {
        this.project().request(['show_loading'], x => {
        }, {});
    }

    hideIndeterminateLoading() {
        this.project().request(['hide_loading'], x => {
        }, {});
    }

    __impl_showIndeterminateLoading() {
        $("#loading_indicator").show();
    }

    __impl_hideIndeterminateLoading() {
        $("#loading_indicator").hide();
    }

    hideIndeterminateLoading() {
        this.project().request(['hide_loading'], x => {
        }, {});
    }

    static filterComponentTree(base, filterfunc = x => x) {
        const ret = [];
        for (const x of base.contentItems) {

            ret.push(...this.filterComponentTree(x, filterfunc));
        }

        return ret.filter(filterfunc);
    }

    static filterComponentTreeByCname(base, componentName) {
        const filterfunc = x => x.config.type == "component" && x.componentName == componentName;
        return base.getItemsByFilter(filterfunc);
    }

    groupSDFGs() {
        this.generic_group(x => x.config.type == "component" && x.componentName == "SDFGComponent");
    }

    groupCodeOuts() {
        this.generic_group(x => x.config.type == "component" && x.componentName == "CodeOutComponent");
    }

    groupOptGraph() {
        this.generic_group(x => x.config.type == "component" && x.componentName == "OptGraphComponent");
    }

    groupSDFGsAndCodeOutsTogether() {
        let comps = this.goldenlayout.root.getItemsByFilter(x => x.config.type == "component" && x.componentName == 'SDFGComponent');

        const names = []
        for (const x of comps) {
            names.push(x.config.componentState.sdfg_name);
        }

        for (const n of names) {
            this.generic_group(x => x.config.type == "component" &&
                (x.componentName == "SDFGComponent" || x.componentName == "CodeOutComponent") &&
                x.config.componentState.sdfg_name == n);
        }

        // Get the SDFG elements again to set them active
        comps = this.goldenlayout.root.getItemsByFilter(x => x.config.type == "component" && x.componentName == 'SDFGComponent');
        comps.forEach(x => x.parent.setActiveContentItem(x));

    }

    groupLikeDIODE1() {
        /*
        |---------------------------------------------
        | CodeIn  | Opt   |         SDFG             |
        |         | Tree  |       Renderer           |
        |---------------------------------------------
        |         |          |                       |
        | CodeOut | (Perf)   | Prop Renderer         |
        |         |          |                       |
        |         |          |                       |
        ----------------------------------------------
        */

        this.goldenlayout.eventHub.emit("enter-programmatic-destroy", "");

        // Collect the components to add to the layout later
        const code_ins = DIODE.filterComponentTreeByCname(this.goldenlayout.root, "CodeInComponent");
        const opttrees = DIODE.filterComponentTreeByCname(this.goldenlayout.root, "AvailableTransformationsComponent");
        const opthists = DIODE.filterComponentTreeByCname(this.goldenlayout.root, "TransformationHistoryComponent");
        const sdfg_renderers = DIODE.filterComponentTreeByCname(this.goldenlayout.root, "SDFGComponent");
        const code_outs = DIODE.filterComponentTreeByCname(this.goldenlayout.root, "CodeOutComponent");
        const property_renderers = DIODE.filterComponentTreeByCname(this.goldenlayout.root, "PropWinComponent");

        // Note that this only collects the _open_ elements and disregards closed or invalidated ones
        // Base goldenlayout stretches everything to use the full space available, this makes stuff look bad in some constellations
        // We compensate some easily replacable components here
        if (property_renderers.length == 0) {
            // Add an empty property window for spacing

            const c = this.getPseudorandom();
            property_renderers.push({
                config: {
                    type: 'component',
                    componentName: "PropWinComponent",
                    componentState: {
                        created: c
                    }
                }
            });
        }

        // Remove the contentItems already as a workaround for a goldenlayout bug(?) that calls destroy unpredictably
        const to_remove = [code_ins, code_outs, opttrees, opthists, sdfg_renderers, property_renderers];
        for (const y of to_remove) {
            for (const x of y) {
                if (x.componentName != undefined) {
                    x.remove();
                }
                // Otherwise: Might be a raw config
            }
        }

        // Remove existing content
        const c = [...this.goldenlayout.root.contentItems];
        for (const x of c) {
            this.goldenlayout.root.removeChild(x);
        }


        // Create the stacks (such that elements are tabbed)
        const code_in_stack = this.goldenlayout.createContentItem({
            type: 'stack',
            content: [/*...code_ins.map(x => x.config)*/]
        });
        const opttree_stack = this.goldenlayout.createContentItem({
            type: 'stack',
            content: [/*...opttrees.map(x => x.config)*/]
        });
        const sdfg_stack = this.goldenlayout.createContentItem({
            type: 'stack',
            content: [/*...sdfg_renderers.map(x => x.config)*/]
        });
        const code_out_stack = this.goldenlayout.createContentItem({
            type: 'stack',
            content: [/*...code_outs.map(x => x.config)*/]
        });
        const property_stack = this.goldenlayout.createContentItem({
            type: 'stack',
            content: [/*...property_renderers.map(x => x.config)*/]
        });

        const top_row = this.goldenlayout.createContentItem({
            type: 'row',
            content: [/*code_in_stack, opttree_stack, sdfg_stack*/]
        });

        const bottom_row = this.goldenlayout.createContentItem({
            type: 'row',
            content: [/*code_out_stack, property_stack*/]
        });


        const top_bottom = this.goldenlayout.createContentItem({
            type: 'column',
            content: [/*top_row, bottom_row*/]
        });
        // Now add the new layout construction
        this.goldenlayout.root.addChild(top_bottom);

        top_bottom.addChild(top_row);
        top_bottom.addChild(bottom_row);


        top_row.addChild(code_in_stack);
        top_row.addChild(opttree_stack);
        top_row.addChild(sdfg_stack);

        bottom_row.addChild(code_out_stack)
        bottom_row.addChild(property_stack);

        sdfg_renderers.forEach(x => sdfg_stack.addChild(x.config));
        property_renderers.forEach(x => property_stack.addChild(x.config));
        code_outs.forEach(x => code_out_stack.addChild(x.config));
        opttrees.forEach(x => opttree_stack.addChild(x.config));
        opthists.forEach(x => opttree_stack.addChild(x.config));
        code_ins.forEach(x => code_in_stack.addChild(x.config));

        // Everything has been added, but maybe too much: There might be empty stacks.
        // They should be removed to keep a "clean" appearance
        for (const x of [opttree_stack, code_in_stack, sdfg_stack, property_stack]) {
            if (x.contentItems.length == 0) {
                x.remove();
            }
        }


        this.goldenlayout.eventHub.emit("leave-programmatic-destroy", "");
    }

    generic_group(predicate) {
        /*
            Groups the SDFGs into their own Stack

        */
        this.goldenlayout.eventHub.emit("enter-programmatic-destroy", "");
        const sdfg_components = this.goldenlayout.root.getItemsByFilter(predicate);

        if (sdfg_components.length == 0) {
            console.warn("Cannot group, no elements found");
        }
        const new_container = this.goldenlayout.createContentItem({
            type: 'stack',
            contents: []
        });

        for (const x of sdfg_components) {
            const config = x.config;
            x.parent.removeChild(x);
            new_container.addChild(config);
        }

        this.addContentItem(new_container);

        this.goldenlayout.eventHub.emit("leave-programmatic-destroy", "");
    }


    addKeyShortcut(key, func, alt = true, ctrl = false) {
        const keys = [...key];
        const c = {
            'alt': alt,
            'ctrl': ctrl,
            'func': func,
            'state': 0,
            'expect': keys.slice(1)
        };
        if (this._shortcut_functions[keys[0]] === undefined) {
            this._shortcut_functions[keys[0]] = [c];
        } else {
            this._shortcut_functions[keys[0]].push(c);
        }
    }

    onKeyUp(ev) {
        if (ev.altKey == false && ev.key == 'Alt') {
            for (const cs of Object.values(this._shortcut_functions)) {
                for (const c of cs) {
                    c.state = 0;
                }
            }
        }
    }

    onKeyDown(ev) {
        for (const cs of Object.values(this._shortcut_functions)) {
            for (const c of cs) {
                if (ev.altKey == false) {
                    c.state = 0;
                    continue;
                }
                if (c.state > 0) {
                    // Currently in a combo-state
                    if (c.expect[c.state - 1] == ev.key) {
                        c.state += 1;
                        if (c.state > c.expect.length) {
                            // Found multi-key combo, activate
                            c.func();
                            ev.stopPropagation();
                            ev.preventDefault();

                            // Clear the states
                            this.onKeyUp({ altKey: false, key: 'Alt' });
                            return;
                        }
                    }
                }
            }
        }
        const cs = this._shortcut_functions[ev.key];
        if (cs === undefined) return;

        let i = 0;
        for (const c of cs) {
            if (c.alt == ev.altKey && c.ctrl == ev.ctrlKey) {

                if (c.expect.length > 0) {
                    // Multi-key combo expected
                    c.state += 1;
                    console.log("dict value: ", this._shortcut_functions[ev.key][i]);
                    ++i;
                    continue;
                }
                c.func();

                ev.stopPropagation();
                ev.preventDefault();
                // Clear the states
                this.onKeyUp({ altKey: false, key: 'Alt' });
            }
            ++i;
        }
    }

    createNewProject() {
        this._current_project = new DIODE_Project(this);
        this._current_project.clearTransformationHistory();
        sessionStorage.clear();
        window.sessionStorage.setItem("diode_project", this._current_project._project_id);
        this.setupEvents();
    }

    getProject() {
        const proj_id = window.sessionStorage.getItem("diode_project");
        this._current_project = new DIODE_Project(this, proj_id);
        if (proj_id == null || proj_id == undefined) {
            // There was a new project ID assigned, which is stored again in the session storage
            window.sessionStorage.setItem("diode_project", this.getCurrentProject()._project_id);
            this.setupEvents();
        }
    }

    project() {
        // Alias function to emulate context behavior
        return this.getCurrentProject();
    }

    getCurrentProject() {
        return this._current_project;
    }

    setLayout(gl) {
        this.goldenlayout = gl;
    }

    settings() {
        return this._settings;
    }

    getPseudorandom() {
        const date = new Date();
        const millis = date.getTime().toString() + Math.random().toFixed(10).toString() + this._creation_counter.toString();

        ++this._creation_counter;

        console.assert(millis !== undefined, "Millis well-defined");

        return millis;
    }

    multiple_SDFGs_available(sdfgs) {

        const sdfgs_obj = (typeof (sdfgs) == 'string') ? parse_sdfg(sdfgs) : sdfgs;

        for (const x of Object.keys(sdfgs_obj.compounds)) {
            // New sdfg
            const value = sdfgs_obj.compounds[x];
            this.SDFG_available(value, x);
        }
    }

    SDFG_available(sdfg, name = "sdfg") {
        // We create a new component and add it to the layout

        // To provide some distinguation, milliseconds since epoch are used.
        const millis = () => this.getPseudorandom();

        sdfg.sdfg_name = name;

        const create_sdfg_func = () => {
            const new_sdfg_config = {
                title: name,
                type: 'component',
                componentName: 'SDFGComponent',
                componentState: { created: millis(), sdfg_data: sdfg, sdfg_name: name }
            };
            this.addContentItem(new_sdfg_config);
        };
        this.replaceOrCreate(['new-sdfg'], 'SDFGComponent', JSON.stringify(sdfg), create_sdfg_func);

        const create_codeout_func = () => {
            const new_codeout_config = {
                title: "Generated Code",
                type: 'component',
                componentName: 'CodeOutComponent',
                componentState: { created: millis(), code: sdfg, sdfg_name: name }
            };
            this.addContentItem(new_codeout_config);
        }
        if (sdfg.generated_code != undefined) {
            console.log("requesting using ID", this.project());
            this.replaceOrCreate(['new-codeout'], 'CodeOutComponent', sdfg, create_codeout_func);
        }
    }

    Error_available(error) {
        const create_error_func = () => {
            const new_error_config = {
                title: "Error",
                type: 'component',
                componentName: 'ErrorComponent',
                componentState: { error: error }
            };
            this.addContentItem(new_error_config);
        };
        this.replaceOrCreate(['new-error'], 'ErrorComponent', error, create_error_func);
    }

    OptGraph_available(optgraph, name = "") {

        if (typeof optgraph != "string") {
            optgraph = JSON.stringify(optgraph);
        }

        // To provide some distinction, milliseconds since epoch are used.
        const millis = this.getPseudorandom();

        const create_optgraph_func = () => {
            const new_optgraph_config = {
                type: "column",
                content: [{
                    title: name == "" ? "Transformations" : "Transformations for `" + name + "`",
                    type: 'component',
                    componentName: 'AvailableTransformationsComponent',
                    componentState: { created: millis, for_sdfg: name, optgraph_data: optgraph }
                }]
            };
            this.addContentItem(new_optgraph_config);
        };
        this.replaceOrCreate(['new-optgraph-' + name], 'AvailableTransformationsComponent',
            optgraph, create_optgraph_func);

        const create_history_func = () => {
            const new_optgraph_config = {
                type: "column",
                content: [{
                    title: "History",
                    type: 'component',
                    componentName: 'TransformationHistoryComponent',
                    componentState: { created: millis, for_sdfg: name }
                }]
            };
            this.addContentItem(new_optgraph_config);
        };
        this.replaceOrCreate(['new-history-' + name], 'TransformationHistoryComponent',
            optgraph, create_history_func);

    }

    OptGraphs_available(optgraph) {
        let o = optgraph;
        if (typeof (o) == "string") {
            o = JSON.parse(optgraph);
        }

        for (const x of Object.keys(o)) {
            const elem = o[x];
            this.OptGraph_available(elem, x);
        }
    }

    gatherProjectElementsAndCompile(calling_context, direct_passing = {}, options = {},
        on_success = undefined, on_failure = undefined) {
        /*
            This method collects all available elements that can be used for compilation.

            direct_passing: Elements that do not have to be requested, but are available at call time
                .code:          Input code
                .sdfg_props:    SDFG properties deviating from default or changed
                .optpath:       Optimization path to be applied

            options
                .run:           If set to true, the Program is run after compilation
                .no_optgraph:   If set to true, the optgraph is not updated/created
                .term_id        The terminal identifier (if output should be shown), required when run is `true`
                .sdfg_over_code Use the existing SDFG-Serialization if available instead of recompiling from source
                .collect_cb     If set, the collected elements are passed to this function
                .dry_run        If `true`, no operation is passed to the server. This is useful when collecting elements for e.g. saving.
        */

        const code = direct_passing.code;
        const sdfg_props = direct_passing.sdfg_props;
        const optpath = direct_passing.optpath;

        const reqlist = [];
        if (code === undefined) {
            if (options.sdfg_over_code) {
                reqlist.push('sdfg_object');
            }
            reqlist.push('input_code');
        }

        if (optpath === undefined) reqlist.push('optpath');
        /*if(optpath != undefined) {
            optpath = undefined;
            reqlist.push('optpath');
        }*/


        const on_collected = (values) => {
            if (code != undefined) values['input_code'] = code;
            if (sdfg_props != undefined) values['sdfg_props'] = sdfg_props;
            if (optpath != undefined) values['optpath'] = optpath;

            if (options.collect_cb != undefined)
                options.collect_cb(values);

            if (options.dry_run === true)
                return;

            let cis = values['sdfg_object'] != undefined;
            let cval = values['input_code'];

            // Assuming SDFG files start with {
            if (!cis && cval[0] == '{') {
                const sd = parse_sdfg(cval);
                values['sdfg_object'] = {};
                values['sdfg_object'][sd.attributes.name] = cval;

                cis = true;
            }

            if (cis) {
                cval = values['sdfg_object'];
                if (typeof (cval) == 'string')
                    cval = parse_sdfg(cval);
            }

            calling_context.project().request(["clear-errors"], () => {
            });

            if (options.run === true) {
                const runopts = {};
                if (options['perfmodes']) {
                    runopts['perfmodes'] = options['perfmodes'];
                }
                runopts['repetitions'] = 5; // TODO(later): Allow users to configure number
                runopts['code_is_sdfg'] = cis;
                runopts['runnercode'] = values['input_code'];
                this.compile_and_run(calling_context, options.term_id, cval, values['optpath'], values['sdfg_props'], runopts, on_success, on_failure);
            } else {
                let cb = (resp) => {
                    this.replaceOrCreate(['extend-optgraph'], 'AvailableTransformationsComponent', resp, (_) => {
                        this.OptGraphs_available(resp);
                    });
                };
                if (options['no_optgraph'] === true) {
                    cb = undefined;
                }

                this.compile(calling_context, cval, values['optpath'], values['sdfg_props'],
                    {
                        optpath_cb: cb,
                        code_is_sdfg: cis,
                    }, on_success, on_failure);

            }
        }

        calling_context.project().request(reqlist, on_collected, { timeout: 500, on_timeout: on_collected });
    }

    compile(calling_context, code, optpath = undefined, sdfg_node_properties = undefined, options = {},
        on_success = undefined, on_failure = undefined) {
        /*
            options:
                .code_is_sdfg: If true, the code parameter is treated as a serialized SDFG
                .runnercode: [opt] Provides the python code used to invoke the SDFG program if needed
        */
        let post_params = {};
        if (options.code_is_sdfg === true) {
            post_params = { "sdfg": stringify_sdfg(code) };

            post_params['code'] = options.runnercode;
        } else {
            post_params = { "code": code };
        }

        if (optpath != undefined) {
            post_params['optpath'] = optpath;
        }
        if (sdfg_node_properties != undefined) {
            post_params['sdfg_props'] = sdfg_node_properties;
        }
        post_params['client_id'] = this.getClientID();
        const version_string = "1.0";
        REST_request("/dace/api/v" + version_string + "/compile/dace", post_params, (xhr) => {
            if (xhr.readyState === 4 && xhr.status === 200) {

                const peek = parse_sdfg(xhr.response);
                if (peek['error'] != undefined) {
                    // There was at least one error - handle all of them
                    this.handleErrors(calling_context, peek);
                    if (on_failure !== undefined)
                        on_failure();
                } else {
                    // Data is no longer stale
                    this.removeStaleDataButton();

                    const o = parse_sdfg(xhr.response);
                    this.multiple_SDFGs_available(xhr.response);
                    if (options.optpath_cb === undefined) {
                        this.OptGraphs_available(o['compounds']);
                    } else {
                        options.optpath_cb(o['compounds']);
                    }
                    if (on_success !== undefined)
                        on_success();
                }
            }
        });
    }

    handleErrors(calling_context, object) {
        let errors = object['error'];
        if ('traceback' in object)
            errors += '\n\n' + object.traceback;

        this.Error_available(errors);

        if (typeof (errors) == "string") {
            console.warn("Error: ", errors);
            //alert(JSON.stringify(errors));
            return;
        }
        for (const error of errors) {

            if (error.type === "SyntaxError") {
                // This error is most likely caused exclusively by input code

                calling_context.project().request(['new_error'], msg => {
                },
                    {
                        params: error,
                        timeout: 100,
                    });
            } else {
                console.warn("Error: ", error);
                //alert(JSON.stringify(error));
            }
        }
    }

    ui_compile_and_run(calling_context) {

        const millis = this.getPseudorandom();

        const terminal_identifier = "terminal_" + millis;

        // create a new terminal
        const terminal_config = {
            title: "Terminal",
            type: 'component',
            componentName: 'TerminalComponent',
            componentState: { created: millis }
        };
        this.addContentItem(terminal_config);


        this.gatherProjectElementsAndCompile(this, {}, { run: true, term_id: terminal_identifier, sdfg_over_code: true });
    }

    load_perfdata() {
        this.showIndeterminateLoading();
        const client_id = this.getClientID();


        const post_params = {
            client_id: client_id
        };
        REST_request("/dace/api/v1.0/perfdata/get/", post_params, (xhr) => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                const pd = JSON.parse(xhr.response);
                console.log("Got result", pd);

                const ondone = () => {
                    this.hideIndeterminateLoading();
                };

                this.project().request(['draw-perfinfo'], x => {
                    ondone();
                }, {
                    params: pd,
                    on_timeout: ondone
                });
            }
        });
    }

    show_exec_times() {
        const config = {
            type: 'component',
            componentName: 'PerfTimesComponent',
            componentState: {},
            title: "Execution times",
        };

        this.addContentItem(config);
    }

    show_run_options(calling_context) {
        const newconf = {
            type: "component",
            componentName: "RunConfigComponent",
            title: "Run Configuration"
        };

        this.addContentItem(newconf);
    }

    show_inst_options(calling_context) {
        const newconf = {
            type: "component",
            componentName: "InstControlComponent",
            title: "Instrumentation control"
        };

        this.addContentItem(newconf);
    }

    show_roofline(calling_context) {
        const newconf = {
            type: "component",
            componentName: "RooflineComponent",
            title: "Roofline"
        };

        this.addContentItem(newconf);
    }

    compile_and_run(calling_context, terminal_identifier, code, optpath = undefined,
        sdfg_node_properties = undefined, options = {}, on_success = undefined,
        on_failure = undefined) {
        /*
            .runnercode: [opt] Code provided with SDFG to invoke the SDFG program. 
        */
        let post_params = {};
        if (options.code_is_sdfg === true) {
            post_params = { "sdfg": stringify_sdfg(code) };
            post_params['code'] = options.runnercode;
        } else {
            post_params = { "code": code };
        }
        if (optpath != undefined) {
            post_params['optpath'] = optpath;
        }
        if (sdfg_node_properties != undefined) {
            post_params['sdfg_props'] = sdfg_node_properties;
        }
        this.applyCurrentRunConfig().then((remaining_settings) => {
            const client_id = this.getClientID();
            post_params['client_id'] = client_id;
            if (remaining_settings['Instrumentation'] == 'off') {
                post_params['perfmodes'] = undefined;
            } else if (remaining_settings['Instrumentation'] == 'minimal') {
                post_params['perfmodes'] = ["default"];
            } else if (remaining_settings['Instrumentation'] == 'full') {
                post_params['perfmodes'] = ["default", "vectorize", "memop", "cacheop"];
            } else {
                alert("Error! Check console");
                console.error("Unknown instrumentation mode", remaining_settings['Instrumentation']);
                if (on_failure !== undefined) on_failure();
                return;
            }
            //post_params['perfmodes'] = ["default", "vectorize", "memop", "cacheop"];
            let not = remaining_settings['Number of threads'];
            if (typeof (not) == "string") {
                not = JSON.parse(not);
            }
            post_params['corecounts'] = not.map(x => parseInt(x));
            post_params['repetitions'] = 5; // TODO(later): Allow users to configure number
            //post_params['corecounts'] = [1,2,3,4];
            const version_string = "1.0";
            REST_request("/dace/api/v" + version_string + "/run/", post_params, (xhr) => {
                if (xhr.readyState === 4 && xhr.status === 200) {

                    let tmp = xhr.response;
                    if (typeof (tmp) == 'string') tmp = JSON.parse(tmp);
                    if (tmp['error']) {
                        // Normal, users should poll on a different channel now.
                        this.display_current_execution_status(calling_context, terminal_identifier, client_id);
                        if (on_failure !== undefined)
                            on_failure();
                    } else if (on_success !== undefined)
                        on_success();
                }
            });
        });
    }

    display_current_execution_status(calling_context, terminal_identifier, client_id, perf_mode = undefined) {
        const post_params = {};
        post_params['client_id'] = client_id;
        post_params['perf_mode'] = perf_mode;
        const version_string = "1.0";
        REST_request("/dace/api/v" + version_string + "/run/status/", post_params, (xhr) => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                // Show success/error depending on the exit code
                if (xhr.response.endsWith(" 0"))
                    this.toast("Execution ended", "Run ended successfully", 'info');
                else
                    this.toast("Execution ended", "Run failed", 'error');

                // Flush remaining outputs
                const newdata = xhr.response.substr(xhr.seenBytes);
                this.goldenlayout.eventHub.emit(terminal_identifier, newdata);
                xhr.seenBytes = xhr.responseText.length;
            }
            if (xhr.readyState === 3) {
                const newdata = xhr.response.substr(xhr.seenBytes);
                this.goldenlayout.eventHub.emit(terminal_identifier, newdata);
                xhr.seenBytes = xhr.responseText.length;
            }
        });
    }

    toast(title, text, type = 'info', timeout = 10000, icon = undefined, callback = undefined) {
        const toast = VanillaToasts.create({
            title: title,
            text: text,
            type: type, // #TODO: Maybe add check for exit codes as well? (to show success/error)
            icon: icon,
            timeout: timeout,
            callback: callback
        });

        VanillaToasts.setTimeout(toast.id, timeout * 1.1);
    }

    optimize(calling_context, optpath) {
        // The calling_context might be necessary when multiple, different programs are allowed

        if (optpath === undefined) {
            optpath = [];
        }
        const transthis = this;

        const on_data_available = (code_data, sdfgprop_data, from_code) => {
            let code = null;
            if (from_code) {
                code = code_data;
            } else {
                code = code_data;
            }

            let props = null;
            if (sdfgprop_data != undefined)
                props = sdfgprop_data.sdfg_props;
            else
                props = undefined;

            const cb = (resp) => {
                transthis.replaceOrCreate(['extend-optgraph'], 'AvailableTransformationsComponent', resp, (_) => {
                    transthis.OptGraphs_available(resp);
                });
            };

            transthis.compile(calling_context, code, optpath, props, {
                optpath_cb: cb,
                code_is_sdfg: !from_code
            });

        }


        calling_context.project().request(['input_code', 'sdfg_object'], (data) => {

            let from_code = true;
            if (data['sdfg_object'] != undefined) {
                from_code = false;
                data = data['sdfg_object'];
                data = JSON.parse(data);
            } else {
                data = data['input_code'];
            }
            on_data_available(data, undefined, from_code);

        });
    }

    /*
        Tries to talk to a pre-existing element to replace the contents.
        If the addressed element does not exist, a new element is created.
    */
    replaceOrCreate(replace_request, window_name, replace_params, recreate_func) {
        let open_windows = null;
        if (this.goldenlayout.root)
            open_windows = this.goldenlayout.root.getItemsByFilter(x => (x.config.type == "component" &&
                x.componentName == window_name));

        if (open_windows && open_windows.length > 0) {  // Replace
            this.getCurrentProject().request(replace_request, (resp, tid) => {
            },
                {
                    timeout: null,
                    params: replace_params,
                    timeout_id: null
                });
        } else {  // Create
            recreate_func(replace_params);
        }
    }

    /*
        This function is used for debouncing, i.e. holding a task for a small amount of time
        such that it can be replaced with a newer function call which would otherwise get queued.
    */
    debounce(group, func, timeout) {

        if (this._debouncing === undefined) {
            // The diode parent object was not created. The function cannot be debounced in this case.
            return func;
        }
        const transthis = this;
        const debounced = function () {
            if (transthis._debouncing[group] !== undefined) {
                clearTimeout(transthis._debouncing[group]);
            }
            transthis._debouncing[group] = setTimeout(func, timeout);
        };

        return debounced;
    }

    static editorTheme() {
        const theme = localStorage.getItem('diode_ace_editor_theme');
        if (theme === null) {
            return "github";
        }
        return theme;
    }

    static themeString() {
        return "ace/theme/" + DIODE.editorTheme();
    }

    static loadTheme() {
        return $.getScript("external_lib/ace/theme-" + DIODE.editorTheme() + ".js");
    }

    static setTheme(name) {
        localStorage.setItem('diode_ace_editor_theme', name);
    }

    static recompileOnPropertyChange() {
        // Set a tendency towards 'false' 
        return localStorage.getItem('diode_recompile_on_prop_change') == "true";
    }

    static setRecompileOnPropertyChange(boolean_value) {
        if (boolean_value) {
            localStorage.setItem('diode_recompile_on_prop_change', "true");
        } else {
            localStorage.setItem('diode_recompile_on_prop_change', "false");
        }
    }

    static setDebugDevMode(boolean_value) {
        if (boolean_value) {
            localStorage.setItem('diode_DebugDevMode', "true");
        } else {
            localStorage.setItem('diode_DebugDevMode', "false");
        }
    }

    static debugDevMode() {
        /*
            The DebugDev mode determines if internal, not-crucial-for-user properties are shown.
        */
        const v = localStorage.getItem("diode_DebugDevMode");
        return v === "true";
    }
}
