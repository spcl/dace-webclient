// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.
import { DIODE } from "./diode-ui/diode"
import { DIODE_Context_Settings } from "./diode-ui/contexts/settings";
import { DIODE_Context_DIODESettings } from "./diode-ui/contexts/diode_settings";
import { DIODE_Context_CodeIn } from "./diode-ui/contexts/code_in";
import { DIODE_Context_Terminal } from "./diode-ui/contexts/terminal";
import { DIODE_Context_CodeOut } from "./diode-ui/contexts/code_out";
import { DIODE_Context_SDFG } from "./diode-ui/contexts/sdfg";
import { DIODE_Context_PropWindow } from "./diode-ui/contexts/prop_window";
import { DIODE_Context_Runqueue } from "./diode-ui/contexts/runqueue";
import { DIODE_Context_StartPage } from "./diode-ui/contexts/start_page";
import { DIODE_Context_TransformationHistory } from "./diode-ui/contexts/transformation_history";
import { DIODE_Context_AvailableTransformations } from "./diode-ui/contexts/available_transformations";
import { DIODE_Context_Error } from "./diode-ui/contexts/error";
import { DIODE_Context_RunConfig } from "./diode-ui/contexts/run_config";
import { DIODE_Context_PerfTimes } from "./diode-ui/contexts/perf_times";
import { DIODE_Context_InstrumentationControl } from "./diode-ui/contexts/instrumentation_control";
import { DIODE_Context_Roofline } from "./diode-ui/contexts/roofline";

const base_url = "//" + window.location.host;
globalThis.base_url = base_url;

// we cannot import jQuery because w2ui only hijacks the global jQuery instance and has no npm package available
const { $ } = globalThis;

start_DIODE();


export function find_object_cycles(obj) {
    const found = [];

    const detect = (x, path) => {
        if (typeof (x) == "string") {

        }
        else if (x instanceof Array) {
            let index = 0;
            for (const y of x) {
                detect(y, [...path, index])
                ++index;
            }
        }
        else if (x instanceof Object) {
            if (found.indexOf(x) !== -1) {
                // Cycle found
                throw ["Cycle", path, x];
            }
            found.push(x);
            for (const y of Object.keys(x)) {
                if (x.hasOwnProperty(y)) {
                    detect(x[y], [...path, y]);
                }
            }
        }
    }

    return detect(obj, []);

}

export function setup_drag_n_drop(elem, callbackSingle, callbackMultiple, options = { readMode: "text", condition: (elem) => true }) {

    /*
        callbackSingle: (mimetype: string, content: string) => mixed
            Takes the file contents (text) and the mimetype.
        callbackMultiple: reserved
        options:
            .readmode: "text" or "binary"
            .condition: Function called with parameter "elem" determining if the current element should have the handler active
    */

    const drag_enter = (e) => {
        if (!options.condition(elem)) return;
        e.stopPropagation();
        e.preventDefault();
    };

    const drag_over = e => {
        if (!options.condition(elem)) return;
        e.stopPropagation();
        e.preventDefault();
    };

    const drag_drop = e => {
        if (!options.condition(elem)) return;
        const files = Array.from(e.dataTransfer.files);

        if (files.length === 1) {
            e.stopPropagation();
            e.preventDefault();

            // A single file was provided
            const file = files[0];

            const mime = file.type;

            const reader = new FileReader();
            reader.onload = ev => {
                callbackSingle(mime, ev.target.result);
            };
            if (options.readMode == "text") {
                reader.readAsText(file);
            }
            else if (options.readMode == "binary") {
                reader.readAsArrayBuffer(file);
            }
            else {
                throw "Unimplemented read mode " + options.readMode;
            }

        }
        else if (files.length > 1) {
            e.stopPropagation();
            e.preventDefault();

            // #TODO: Deferred 
            alert("Cannot handle more than 1 input file at this point");
            throw "Previous alert caused here";
        }
        else {
            alert("Can only drop files at this point - everything else is user-agent-specific!")
            throw "Previous alert caused here";
        }

    };

    elem.addEventListener("dragenter", drag_enter, false);
    elem.addEventListener("dragover", drag_over, false);
    elem.addEventListener("drop", drag_drop, false);
}

export function REST_request(command, payload, callback, method = "POST") {
    const xhr = new XMLHttpRequest();
    const url = base_url + command;
    xhr.open(method, url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = () => {
        callback(xhr);
    };
    xhr.onerror = (e) => {
        console.warn("Connection error", e);
        alert("Connection error");
    };
    if (payload != undefined) {
        const data = JSON.stringify(payload);
        xhr.send(data);
    }
    else {
        xhr.send();
    }
}

export class FormBuilder {

    static createContainer(idstr) {
        const elem = document.createElement("div");
        elem.id = idstr;
        elem.classList = "settings_key_value";
        return $(elem);
    }

    static createHostInput(id, onchange, known_list = ['localhost'], initial = "localhost") {
        const elem = document.createElement('input');
        elem.type = "list";
        elem.id = id;
        let dlist = document.getElementById("hosttype-dlist");
        if (!dlist) {
            dlist = document.createElement("datalist");
            dlist.id = "hosttype-dlist";
            document.body.appendChild(dlist);
        }
        $(elem).attr("list", "hosttype-dlist");
        dlist.innerHTML = "";
        for (const x of known_list) {
            dlist.innerHTML += '<option value="' + x + '">'
        }

        elem.value = initial;
        elem.onchange = () => {
            onchange(elem);
        };

        return $(elem);
    }

    static createComboboxInput(id, onchange, known_list, initial) {
        const elem = document.createElement('div');
        const inputelem = document.createElement('input');
        inputelem.type = "list";
        inputelem.id = id;
        inputelem.onfocus = () => {
            // Clear (this will make it act more like a select)
            const oldvalue = inputelem.value;
            inputelem.onblur = () => {
                inputelem.value = oldvalue;
            }
            inputelem.value = "";

        }
        const dlist = document.createElement("datalist");
        dlist.id = id + "-dlist";
        elem.appendChild(dlist);

        $(inputelem).attr("list", id + "-dlist");
        dlist.innerHTML = "";
        for (const x of known_list) {
            dlist.innerHTML += '<option value="' + x + '">'
        }

        inputelem.value = initial;
        inputelem.onchange = () => {
            inputelem.onblur = null;
            onchange(inputelem);
        };

        elem.appendChild(inputelem);

        return $(elem);
    }

    static createCodeReference(id, onclick, obj) {
        const elem = document.createElement('span');
        elem.id = id;
        elem.addEventListener('click', x => {
            onclick(x);
        });
        elem.classList.add("code_ref");

        if (obj == null || obj.filename == null) {
            elem.innerText = "N/A";
            elem.title = "The DebugInfo for this element is not defined";
        }
        else {
            const split = obj.filename.split("/");
            const fname = split[split.length - 1];

            elem.innerText = fname + ":" + obj.start_line;
            elem.title = obj.filename;
        }

        return $(elem);
    }

    static createLabel(id, labeltext, tooltip) {
        const elem = document.createElement("span");
        elem.id = id;
        elem.innerHTML = labeltext;
        elem.title = tooltip;
        elem.classList = "title";

        return $(elem);
    }

    static createToggleSwitch(id, onchange, initial = false) {
        const legacy = false;
        const elem = document.createElement("input");
        elem.onchange = () => {
            onchange(elem);
        }
        elem.type = "checkbox";
        elem.id = id;
        elem.checked = initial;


        if (!legacy) {
            // Add CSS "toggle-slider" elements
            // This requires more HTML.
            const styled_elem = document.createElement("label");
            styled_elem.classList = "switch";
            $(styled_elem).append(elem);
            $(styled_elem).append($('<span class="slider round"></span>'));
            return $(styled_elem);
        }

        return $(elem);
    }


    static createTextInput(id, onchange, initial = '') {
        const elem = document.createElement("input");
        // oninput triggers on every change (as opposed to onchange, which only changes on deselection)
        elem.onchange = () => {
            onchange(elem);
        }
        elem.type = "text";
        elem.id = id;
        elem.value = initial
        return $(elem);
    }

    static createLongTextInput(id, onchange, initial = '') {
        const elem = document.createElement("textarea");
        // oninput triggers on every change (as opposed to onchange, which only changes on deselection)
        elem.onchange = () => {
            onchange(elem.innerHTML);
        }
        elem.id = id;
        elem.innerHTML = initial
        return $(elem);
    }

    static createSelectInput(id, onchange, options, initial = '') {
        const elem = document.createElement("select");

        for (const option of options) {
            const option_elem = document.createElement('option');
            option_elem.innerText = option;
            elem.append(option_elem);
        }

        // oninput triggers on every change (as opposed to onchange, which only changes on deselection)
        elem.oninput = () => {
            onchange(elem);
        }
        elem.id = id;
        elem.value = initial;
        return $(elem);
    }

    static createIntInput(id, onchange, initial = 0) {
        const elem = document.createElement("input");
        elem.oninput = () => {
            onchange(elem);
        }
        elem.type = "number";
        elem.step = 1;
        elem.id = id;
        elem.value = initial;
        return $(elem);
    }


    static createFloatInput(id, onchange) {
        const elem = document.createElement("input");
        elem.oninput = () => {
            onchange(elem);
        }
        elem.type = "number";
        elem.id = id;
        return $(elem);
    }

    static createButton(id, onclick, label) {
        const elem = document.createElement("button");
        elem.onclick = () => {
            onclick(elem);
        };
        elem.innerHTML = label;
        return $(elem);
    }
}

function start_DIODE() {
    const diode = new DIODE();
    window.diode = diode;
    diode.initEnums();
    diode.pubSSH(true);

    $("#toolbar").w2toolbar({
        name: "toolbar",
        items: [
            {
                type: 'menu', id: 'file-menu', caption: 'File', icon: 'material-icons-outlined gmat-folder', items: [
                    { text: 'Start', icon: 'material-icons-outlined gmat-new_folder', id: 'start' },
                    { text: 'Open', icon: 'material-icons-outlined gmat-open', id: 'open-file' },
                    { text: 'Save', icon: 'material-icons-outlined gmat-save', id: 'save' },
                ]
            },
            { type: 'break', id: 'break0' },
            {
                type: 'menu', id: 'settings-menu', caption: 'Settings', icon: 'material-icons-outlined gmat-settings', items: [
                    { text: 'DACE settings', icon: 'material-icons-outlined gmat-settings-cloud', id: 'diode-settings' },
                    { text: 'DIODE settings', icon: 'material-icons-outlined gmat-settings-application', id: 'diode-settings' },
                    { text: 'Run Configurations', icon: 'material-icons-outlined gmat-playlist_play', id: 'runoptions' },
                    { text: 'Runqueue', icon: 'material-icons-outlined gmat-view_list', id: 'runqueue' },
                    { text: 'Perfdata', id: 'perfdata' },
                    { text: 'Perftimes', id: 'perftimes' },
                ]
            },
            {
                type: 'menu', icon: 'material-icons-outlined gmat-build', id: 'compile-menu', caption: 'Compile', items: [
                    { text: 'Compile', id: 'compile', icon: 'material-icons-outlined gmat-gavel' },
                    { text: 'Run', id: 'run', icon: 'material-icons-outlined gmat-play' },
                    { text: 'Discard changes and compile source', id: 'compile-clean', icon: 'material-icons-outlined gmat-clear' },
                ]
            },
            {
                type: 'menu-radio', id: 'runconfig', text: function (item) {
                    const t = (typeof (item.selected) == 'string') ? item.selected : item.selected(); const el = this.get('runconfig:' + t); return "Config: " + ((el == null) ? diode.getCurrentRunConfigName() : el.text);
                }, selected: function (item) {
                    return diode.getCurrentRunConfigName();
                }, items: [{
                    id: 'default', text: "default"
                }
                ]
            },
            {
                type: 'menu', id: 'transformation-menu', caption: 'Transformations', items: [
                    { text: 'History', id: 'history' },
                    { text: 'Available Transformations', id: 'available' },

                ]
            },
            {
                type: 'menu', id: 'group-menu', caption: 'Group', icon: 'material-icons-outlined gmat-apps', items: [
                    //{ text: 'Group by SDFGs', id: 'group-sdfgs' }, 
                    { text: 'Group default', id: 'group-diode1' }
                ]
            },
            { type: 'menu', id: 'closed-windows', caption: 'Closed windows', icon: 'material-icons-outlined gmat-reopen', items: [] },
        ],
        onClick: function (event) {
            if (event.target === 'file-menu:open-file') {
                diode.openUploader("code-python");
            }
            if (event.target === 'file-menu:start') {
                // Close all windows before opening Start component
                diode.closeAll();

                const config = {
                    type: 'component',
                    componentName: 'StartPageComponent',
                    componentState: {}
                };

                diode.addContentItem(config);
            }
            if (event.target === 'file-menu:save') {
                diode.project().save();
            }
            if (event.target == "settings-menu:diode-settings") {
                diode.open_diode_settings();
            }
            if (event.target == "settings-menu:runqueue") {
                diode.open_runqueue();
            }
            if (event.target == "settings-menu:perfdata") {
                //diode.load_perfdata();
                diode.show_inst_options();
            }
            if (event.target == "settings-menu:perftimes") {
                diode.show_exec_times();
            }
            if (event.target == "group-menu:group-sdfgs") {
                diode.groupOptGraph(); diode.groupSDFGsAndCodeOutsTogether();
            }
            if (event.target == "group-menu:group-diode1") {
                diode.groupLikeDIODE1();
            }
            if (event.target == "runconfig") {
                const m = this.get(event.target);

                const configs = diode.getRunConfigs();

                m.items = [];

                for (const c of configs) {
                    const cname = c['Configuration name'];
                    m.items.push({ id: cname, text: cname });
                }
            }
            if (event.target.startsWith("runconfig:")) {
                const name = event.target.substr("runconfig:".length);
                diode.setCurrentRunConfig(name);
            }
            if (event.target == "transformation-menu:history") {
                diode.addContentItem({
                    type: 'component',
                    componentName: 'TransformationHistoryComponent',
                    title: "Transformation History",
                    componentState: {}
                });
            }
            if (event.target == "transformation-menu:available") {
                diode.addContentItem({
                    type: 'component',
                    componentName: 'AvailableTransformationsComponent',
                    componentState: {}
                });
            }
            if (event.target == "compile-menu:compile") {
                // "Normal" recompilation
                diode.gatherProjectElementsAndCompile(diode, {}, {
                    sdfg_over_code: true
                });
            }
            if (event.target == "compile-menu:compile-clean") {
                diode.project().request(["clear-errors"], () => { });
                diode.project().discardTransformationsAfter(0);
                // Compile, disregarding everything but the input code
                diode.project().request(['input_code'], msg => {
                    diode.compile(diode, msg['input_code']);
                }, {
                    timeout: 300,
                    on_timeout: () => alert("No input code found, open a new file")
                });
            }
            if (event.target == "settings-menu:runoptions") {
                diode.show_run_options(diode);
            }
            if (event.target == "compile-menu:run") {
                // Running

                diode.ui_compile_and_run(diode);
            }
            if (event.target == "closed-windows") {
                const m = this.get(event.target);

                // Clear the items first (they will be re-read from the project)
                m.items = [];

                // Add a "clear all"
                m.items.push({ text: "Clear all", id: 'clear-closed-windows', icon: 'material-icons-outlined gmat-clear' });

                const elems = diode.project().getClosedWindowsList();
                for (const x of elems) {
                    const name = x[0];

                    m.items.push({ text: name, id: 'open-closed-' + x[1].created });
                }

                this.refresh();

            }
            if (event.target == 'closed-windows:clear-closed-windows') {
                diode.project().clearClosedWindowsList();
            }
            if (event.target.startsWith("closed-windows:open-closed-")) {
                // This is a request to re-open a closed window
                let name = event.target;
                name = name.substr("closed-windows:open-closed-".length);

                diode.project().reopenClosedWindow(name);

            }
        }
    });


    const goldenlayout_config = {
        content: [{
            type: 'row',
            content: [{
                type: 'component',
                componentName: 'StartPageComponent',
                componentState: {}
            }]
        }]
    };

    const saved_config = sessionStorage.getItem('savedState');
    //saved_config = null; // Don't save the config during development
    let goldenlayout = null;
    if (saved_config !== null) {
        goldenlayout = new GoldenLayout(JSON.parse(saved_config), $('#diode_gl_container'));
    }
    else {
        goldenlayout = new GoldenLayout(goldenlayout_config, $('#diode_gl_container'));
    }

    goldenlayout.on('stateChanged', diode.debounce("stateChanged", () => {
        if (!(goldenlayout.isInitialised && goldenlayout.openPopouts.every(popout => popout.isInitialised))) {
            return;
        }
        // Don't serialize SubWindows
        if (goldenlayout.isSubWindow)
            return;
        const tmp = goldenlayout.toConfig();
        //find_object_cycles(tmp);
        const state = JSON.stringify(tmp);
        sessionStorage.setItem('savedState', state);
    }, 500));

    if (!goldenlayout.isSubWindow) {
        goldenlayout.eventHub.on('create-window-in-main', x => {
            const config = JSON.parse(x);

            diode.addContentItem(config);
        });
    }

    goldenlayout.registerComponent('testComponent', (container, componentState) => {
        container.getElement().html('<h2>' + componentState.label + '</h2>');
    });
    goldenlayout.registerComponent('SettingsComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_Settings(diode, container, componentState);
        $(container.getElement()).load("settings_view.html", () => {
            diode_context.get_settings();
        });

    });
    goldenlayout.registerComponent('PerfTimesComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_PerfTimes(diode, container, componentState);
        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.create();
    });
    goldenlayout.registerComponent('InstControlComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_InstrumentationControl(diode, container, componentState);
        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.create();
    });
    goldenlayout.registerComponent('RooflineComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_Roofline(diode, container, componentState);
        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.create();
    });
    goldenlayout.registerComponent('SDFGComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_SDFG(diode, container, componentState);

        diode_context.create_renderer_pane(componentState["sdfg_data"]);
        diode_context.setupEvents(diode.getCurrentProject());
    });
    goldenlayout.registerComponent('TransformationHistoryComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_TransformationHistory(diode, container, componentState);
        diode_context.setupEvents(diode.getCurrentProject());
        const hist = diode_context.project().getTransformationHistory();
        diode_context.create(hist);

    });
    goldenlayout.registerComponent('AvailableTransformationsComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_AvailableTransformations(diode, container, componentState);
        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.create();

    });
    goldenlayout.registerComponent('CodeInComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_CodeIn(diode, container, componentState);
        const editorstring = "code_in_" + diode_context.created;
        const parent_element = $(container.getElement());
        const new_element = $("<div id='" + editorstring + "' style='height: 100%; width: 100%; overflow-y:auto'></div>");


        parent_element.append(new_element);
        parent_element.hide().show(0);

        (function () {
            const editor_div = new_element;
            editor_div.attr("id", editorstring);
            editor_div.text(componentState.code_content);
            editor_div.hide().show(0);
            const editor = ace.edit(new_element[0]);
            editor.setTheme(DIODE.themeString());
            editor.session.setMode("ace/mode/python");
            editor.getSession().on('change', () => {
                container.extendState({ "code_content": editor.getValue() });
            });

            setup_drag_n_drop(new_element[0], (mime, content) => {
                // #TODO: Set session mode from mime type - but we need a switch to manually do that first
                console.log("File dropped", mime, content);

                editor.setValue(content);
                editor.clearSelection();
            });

            editor.resize();

            editor.commands.addCommand({
                name: 'Compile',
                bindKey: { win: 'Ctrl-P', mac: 'Command-P' },
                exec: function (editor) {
                    alert("Compile pressed");
                    diode_context.compile(editor.getValue());
                },
                readOnly: true // false if this command should not apply in readOnly mode
            });
            editor.commands.addCommand({
                name: 'Compile and Run',
                bindKey: { win: 'Alt-R', mac: 'Alt-R' },
                exec: function (editor) {
                    alert("Compile & Run pressed");
                    diode_context.compile_and_run(editor.getValue());
                },
                readOnly: true // false if this command should not apply in readOnly mode
            });
            diode_context.setEditorReference(editor);
            diode_context.setupEvents(diode.getCurrentProject());
        })
            ()
            ;


    });

    goldenlayout.registerComponent('CodeOutComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_CodeOut(diode, container, componentState);
        const editorstring = "code_out_" + diode_context.created;
        const parent_element = $(container.getElement());
        const new_element = $("<div id='" + editorstring + "' style='height: 100%; width: 100%; overflow:auto'></div>");


        parent_element.append(new_element);
        parent_element.hide().show(0);

        (() => {
            const editor_div = new_element;
            editor_div.attr("id", editorstring);
            editor_div.hide().show(0);
            const editor = ace.edit(new_element[0]);
            editor.setTheme(DIODE.themeString());
            editor.session.setMode("ace/mode/c_cpp");
            editor.setReadOnly(true);


            diode_context.setEditorReference(editor);
            diode_context.setupEvents(diode.getCurrentProject());

            const extracted = diode_context.getState().code;
            diode_context.setCode(extracted);
            editor.resize();
        })
            ()
            ;


    });

    // Create an error component which is used for all errors originating in python.
    // As such, the errors are usually tracebacks. The current implementation
    // (just displaying the output) is rudimentary and can/should be improved.
    // #TODO: Improve the error-out formatting
    goldenlayout.registerComponent('ErrorComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_Error(diode, container, componentState);
        const editorstring = "error_" + diode_context.created;
        const parent_element = $(container.getElement());
        const new_element = $("<div id='" + editorstring + "' style='height: 100%; width: 100%; overflow:auto'></div>");


        parent_element.append(new_element);
        parent_element.hide().show(0);

        (() => {
            const editor_div = new_element;
            editor_div.attr("id", editorstring);
            editor_div.hide().show(0);
            const editor = ace.edit(new_element[0]);
            editor.setTheme(DIODE.themeString());
            editor.session.setMode("ace/mode/python");


            diode_context.setEditorReference(editor);
            diode_context.setupEvents(diode.getCurrentProject());

            const extracted = diode_context.getState().error;
            diode_context.setError(extracted);
            editor.resize();
        })
            ()
            ;


    });

    goldenlayout.registerComponent('TerminalComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_Terminal(diode, container, componentState);
        const editorstring = "terminal_" + diode_context.created;
        const parent_element = $(container.getElement());
        const new_element = $("<div id='" + editorstring + "' style='height: 100%; width: 100%; overflow:auto'></div>");

        parent_element.append(new_element);
        parent_element.hide().show(0);


        const editor_div = new_element;
        editor_div.hide().show(0);
        const editor = ace.edit(new_element[0]);
        editor.setTheme(DIODE.themeString());
        editor.session.setMode("ace/mode/sh");
        editor.setReadOnly(true);

        const firstval = diode_context.getState().current_value;
        if (firstval !== undefined)
            editor.setValue(firstval);
        editor.clearSelection();

        diode_context.setEditorReference(editor);

        console.log("Client listening to", editorstring);

        goldenlayout.eventHub.on(editorstring, (e) => {
            diode_context.append(e);
        });

        diode_context.setupEvents(diode.getCurrentProject());
    });

    goldenlayout.registerComponent('DIODESettingsComponent', (container, componentState) => {
        const diode_context = new DIODE_Context_DIODESettings(diode, container, componentState);
        const divstring = "diode_settings" + diode_context.created;
        const parent_element = $(container.getElement());
        const new_element = $("<div id='" + divstring + "' style='height: 100%; width: 100%; overflow:auto'></div>");

        new_element.append("<h1>DIODE settings</h1>");
        diode_context.setContainer(new_element);
        parent_element.append(new_element);

    });

    goldenlayout.registerComponent('RunConfigComponent', (container, componentState) => {
        const diode_context = new DIODE_Context_RunConfig(diode, container, componentState);

        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.create();
    });

    goldenlayout.registerComponent('PropWinComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_PropWindow(diode, container, componentState);

        const elem = document.createElement('div');
        elem.classList.add("sdfgpropdiv");
        elem.style = "width: 100%; height: 100%";
        $(container.getElement()).append(elem);

        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.createFromState();
    });

    goldenlayout.registerComponent('StartPageComponent', (container, componentState) => {
        const diode_context = new DIODE_Context_StartPage(diode, container, componentState);



        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.create();
    });

    goldenlayout.registerComponent('RunqueueComponent', (container, componentState) => {
        // Wrap the component in a context 
        const diode_context = new DIODE_Context_Runqueue(diode, container, componentState);


        diode_context.setupEvents(diode.getCurrentProject());
        diode_context.create();
    });

    goldenlayout.on('itemDestroyed', e => {
        if (e.config.componentState === undefined) {
            // Skip non-components
            return;
        }
        const x = e.config.componentState.created;
        goldenlayout.eventHub.emit('destroy-' + x);
        console.log("itemDestroyed", e);
    });

    diode.setLayout(goldenlayout);
    diode.getProject();


    goldenlayout.init();

    window.addEventListener('resize', x => {
        // goldenlayout does not listen to resize events if it is not full-body
        // So it must be notified manually
        goldenlayout.updateSize();
    });


    document.body.addEventListener('keydown', (ev) => {
        diode.onKeyDown(ev);
    });
    document.body.addEventListener('keyup', (ev) => {
        diode.onKeyUp(ev);
    });
    diode.addKeyShortcut('gg', () => { diode.groupOptGraph(); diode.groupSDFGsAndCodeOutsTogether(); });
    diode.addKeyShortcut('gd', () => { diode.groupLikeDIODE1(); });
    diode.addKeyShortcut('0', () => {
        diode.open_diode_settings();
    });
    diode.addKeyShortcut('r', () => { diode.gatherProjectElementsAndCompile(diode, {}, { sdfg_over_code: true }); });
    diode.addKeyShortcut('s', () => { diode.project().save(); }, false, true);

    diode.setupEvents();

    // Add drag & drop for the empty goldenlayout container
    const dgc = $("#diode_gl_container");
    const glc = dgc[0].firstChild;
    setup_drag_n_drop(glc, (mime, content) => {
        console.log("File dropped", mime, content);

        const config = {
            type: "component",
            componentName: "CodeInComponent",
            componentState: {
                code_content: content
            }
        };

        diode.addContentItem(config);
    }, undefined, {
        readMode: "text",
        condition: (elem) => elem.childNodes.length == 0 // Only if empty
    });
}
