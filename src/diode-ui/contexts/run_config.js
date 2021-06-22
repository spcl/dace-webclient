import { DIODE_Context } from "./context";


export class DIODE_Context_RunConfig extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

        this._settings_container = null;

    }

    create() {
        const parent = this.container.getElement()[0];

        const runopts_container = document.createElement("div");

        const runopts_general_container = document.createElement("div");

        let values = {
            "Configuration name": "",
            "Host": "localhost",
            "Use SSH": true,
            "SSH Key": this.diode.pubSSH(),
            "SSH Key override": "",
            "Instrumentation": "off",
            "Number of threads": "[0]"
        };

        let params = [];
        const node = null;
        let transthis = null;

        // Build the callback object
        transthis = {
            propertyChanged: (node, name, value) => {
                if (name == "Configuration name") {
                    if (this.diode.getRunConfigs().map(x => x['Configuration name']).includes(value)) {
                        // Load values and reset inputs
                        const copy = this.diode.getRunConfigs(value);
                        for (const x of Object.keys(copy)) {
                            const v = copy[x];
                            const ps = params.find(y => y.name == x);
                            ps.value = v;
                        }
                        values = copy;
                        runopts_general_container.innerHTML = "";
                        this.diode.renderProperties(transthis, node, params, runopts_general_container, {});
                        return;
                    }
                }
                values[name] = value;
            }
        };
        /*
        element structure:
        {
            name: <name>
            desc: <description> (as tooltip)
            category: <Category name>
            type: <Type used to render>
            value: <Value to store>
        }
        */
        {
            params = [{
                name: "Configuration name",
                type: "combobox",
                value: values['Configuration name'],
                options: this.diode.getRunConfigs().map(x => x['Configuration name']),
                desc: "Name of this configuration",
            }, {
                name: "Host",
                type: "hosttype",
                value: values['Host'],
                desc: "Host executing the programs",
            },
            ]; // Array of elements


            // Add category (common to all elements)
            params.forEach(x => x.category = "General");

            const remoteparams = [{
                name: "Use SSH",
                type: "bool",
                value: values['Use SSH'],
                desc: "Use SSH. Mandatory for remote hosts, optional for localhost.",
            }, {
                name: "SSH Key",
                type: "str",
                value: values['SSH Key'],
                desc: "Public SSH key (id_rsa.pub) to add to remote authorized_keys. This key must not be password-protected!",
            }, {
                name: "SSH Key override",
                type: "str",
                value: values['SSH Key override'],
                desc: "Override the identity key file (ssh option -i) with this value if your password-free key is not id_rsa"
            }
            ];

            // Add category (common to all elements)
            remoteparams.forEach(x => x.category = "Remote");

            const instrumentationparams = [{
                name: "Instrumentation",
                type: "selectinput",
                value: values['Instrumentation'],
                options: ['off', 'minimal', 'full'],
                desc: "Set instrumentation mode (CPU only)",
            },
            {
                name: "Number of threads",
                type: "list",
                value: values['Number of threads'],
                desc: "Sets the number of OpenMP threads." +
                    "If multiple numbers are specified, the program is executed once for every number of threads specified. Specify 0 to use system default"
            },

            ];

            // Add category (common to all elements)
            instrumentationparams.forEach(x => x.category = "Profiling");


            // Merge params
            params = [...params, ...remoteparams, ...instrumentationparams];

            const node = {
                data: () => params
            };

            // Build the settings
            this.diode.renderProperties(transthis, node, params, runopts_general_container, {});
        }


        runopts_container.appendChild(runopts_general_container);


        parent.appendChild(runopts_container);

        const apply_button = document.createElement("button");
        apply_button.innerText = "Save";
        apply_button.addEventListener('click', _x => {
            this.diode.addToRunConfigs(values);
        });
        parent.appendChild(apply_button);
    }


}
