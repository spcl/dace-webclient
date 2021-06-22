import { REST_request } from "../../main";
import * as DiodeTables from "../table";
import { DIODE_Settings } from "../diode_settings";
import { TreeView, ValueTreeNode } from "../treeview";
import { DIODE_Context } from "./context";
import { DIODE } from "../diode";
const { $ } = globalThis;

export class DIODE_Context_Settings extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);
    }

    settings_change_callback(type, path, value) {

        console.assert(value !== undefined, "Undefined value");

        console.log("Setting changed", path, value);
        this.diode.settings().change(path, value);

        this.set_settings();
    }

    link_togglable_onclick(element, toToggle) {
        const toggleclassname = "collapsed_container";
        element.on('click', () => {
            if (toToggle.hasClass(toggleclassname)) {
                toToggle.removeClass(toggleclassname);
            } else {
                toToggle.addClass(toggleclassname);
            }
        });
    }

    parse_settings2(settings, parent = undefined, path = []) {
        let is_topmost = false;
        if (parent === undefined) {
            parent = new ValueTreeNode("Settings", null);
            is_topmost = true;
        }

        let dicts = [];
        const values = [];


        Object.entries(settings).forEach(
            ([key, value]) => {
                const meta = value.meta;
                const val = value.value;

                if (meta.type == 'dict') {
                    dicts.push([key, value]);
                } else {
                    values.push([key, value]);
                }
            });

        let settings_lookup = {};
        // Create the elements that are not in subcategories (=dicts) here
        const dt = new DiodeTables.Table();
        {
            let params = JSON.parse(JSON.stringify(values));
            params = params.map(x => {
                const key = x[0];
                x = x[1];
                const tmp = x.meta;
                tmp.value = x.value;
                tmp.name = tmp.title;
                tmp.category = "General";
                tmp.key = key;
                return tmp;
            });

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
                delete categories["(Debug)"];
            }
            // INSERTED
            const transthis = {
                propertyChanged: (path, name, value) => {
                    console.log("PropertyChanged", path, name, value);
                    this.settings_change_callback(undefined, path, value);
                }
            };
            // !INSERTED
            for (const z of Object.entries(categories)) {

                // Sort within category
                const cat_name = z[0];
                const y = z[1].sort((a, b) => a.name.localeCompare(b.name));


                // Add Category header
                cur_dt = dt;
                const sp = document.createElement('span');
                sp.innerText = cat_name;
                const tr = cur_dt.addRow(sp);
                tr.childNodes[0].colSpan = "2";

                dtc = new DiodeTables.TableCategory(cur_dt, tr);

                for (const x of y) {

                    settings_lookup[path] = x.value;

                    const value_part = diode.getMatchingInput(transthis, x, [...path, x.key]);
                    const cr = cur_dt.addRow(x.name, value_part);
                    if (dtc != null) {
                        dtc.addContentRow(cr);
                    }
                }
            }
            dt.setCSSClass("diode_property_table");
        }
        // Link handlers
        parent.setHandler("activate", (node, level) => {
            if (level == 1) {
                const repr = node.representative();
                // Clear all selections in this tree
                node.head().asPreOrderArray(x => x.representative()).forEach(x => x.classList.remove("selected"));
                repr.classList.add("selected");
                const cont = $("#diode_settings_props_container")[0];
                cont.innerHTML = "";
                dt.createIn(cont);
            }
        });

        // Recurse into (sorted) dicts
        dicts = dicts.sort((a, b) => a[1].meta.title.localeCompare(b[1].meta.title));

        for (let d of dicts) {
            const key = d[0];
            d = d[1];
            const setting_path = path.concat(key);
            // Create the list element first
            const newparent = parent.addNode(d.meta.title, null);
            // The representative DOM node does not exist yet - add hints after half a second.
            setTimeout(() => newparent.representative().title = d.meta.description, 500);

            // Recurse
            console.log("Setting path", setting_path);
            const tmp = this.parse_settings2(d.value, newparent, setting_path);
            settings_lookup = { ...settings_lookup, ...tmp };
        }

        if (is_topmost) {
            const _tree = new TreeView(parent);
            _tree.create_html_in($("#diode_settings_container")[0]);
        }
        return settings_lookup;
    }

    get_settings() {
        const post_params = {
            client_id: this.diode.getClientID()
        };
        REST_request("/dace/api/v1.0/preferences/get", post_params, (xhr) => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                const settings = this.parse_settings2(JSON.parse(xhr.response));

                this.diode._settings = new DIODE_Settings(settings);
                //this.diode._settings = null;
            }
        });
    }

    set_settings() {
        if (!this.diode.settings().hasChanged()) {
            // Do not update if nothing has changed
            return;
        }
        // Find settings that changed and write them back
        const changed_values = this.diode.settings().changedValues();
        this.saveToState({
            "changed": changed_values,
            "confirmed": this.diode.settings().values()
        });
        // #TODO: Maybe only update when a "save"-Button is clicked?
        const transthis = this;
        const client_id = this.diode.getClientID();
        const post_params = changed_values;
        post_params['client_id'] = client_id;
        // Debounce
        const debounced = this.diode.debounce("settings-changed", function () {

            REST_request("/dace/api/v1.0/preferences/set", post_params, (xhr) => {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    transthis.diode.settings().clearChanged();
                    this.diode.toast("Settings changed", "The changed settings were applied at remote server", "info", 3000);
                }
            });
        }, 1000);
        debounced();
    }
}
