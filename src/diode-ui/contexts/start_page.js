import { DIODE_Context } from "./context";
import { DIODE_Project } from "../diode_project";
const { $ } = globalThis;

export class DIODE_Context_StartPage extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);
    }

    create() {
        let plus = `<svg width="50" height="50" version="1.1" viewBox="0 0 13.2 13.2" xmlns="http://www.w3.org/2000/svg"><g transform="translate(0 -284)"><g fill="none" stroke="#008000" stroke-width="2.65"><path d="m6.61 285v10.6"/><path d="m1.32 290h10.6"/></g></g></svg>`;
        plus = "data:image/svg+xml;base64," + btoa(plus);

        this.container.setTitle("Start Page");


        const parent = $(this.container.getElement())[0];

        const header = document.createElement('h1');
        header.id = "startpage_header";
        header.innerText = "DIODE";
        parent.appendChild(header);

        const startpage_container = document.createElement('div');
        startpage_container.id = 'startpage_container';
        startpage_container.classList = "flex_row";
        startpage_container.style = "width: 100%;height:100%;";

        const startpage_recent = document.createElement('div');
        startpage_recent.id = 'startpage_recent';
        {
            const file_title = document.createElement('div');
            file_title.innerText = "New";
            file_title.classList = "startpage_title";
            startpage_recent.appendChild(file_title);

            startpage_recent.appendChild(this.createStartpageListElement("Create a new Project", null, null, plus, x => {
                this.container.close();

                // Force creation of a new "project" instance (since we are explicitly creating a new project)
                // (NOTE: Functionality moved to "newFile")
                //this.diode.createNewProject();
                this.diode.openUploader("code-python");
            }));


            const recent_title = document.createElement('div');
            recent_title.innerText = "Recent";
            recent_title.classList = "startpage_title";
            startpage_recent.appendChild(recent_title);
        }
        const startpage_resources = document.createElement('div');
        startpage_resources.id = 'additional_resources';
        {
            const resource_title = document.createElement('div');
            resource_title.innerText = "Resources";
            resource_title.classList = "startpage_title";
            startpage_resources.appendChild(resource_title);
        }


        // Load elements from list
        {
            const projects = DIODE_Project.getSavedProjects();
            for (const p of projects) {
                console.log("p", p);

                const pdata = DIODE_Project.getProjectData(p);

                startpage_recent.appendChild(this.createStartpageListElement(p, pdata.last_saved, pdata.description, undefined, x => {
                    DIODE_Project.load(this.diode, p);
                }));
            }

        }

        let dace_logo = `
        <svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" id="svg13" height="60.891094" width="57.565113" version="1.0" viewBox="0 0 143.91279 152.22773" inkscape:version="0.92.3 (2405546, 2018-03-11)">
          
          <metadata id="metadata17">
            
          </metadata>
          <defs id="defs3">
            <pattern y="0" x="0" height="6" width="6" patternUnits="userSpaceOnUse" id="EMFhbasepattern"/>
          </defs>
          <path id="path5" d="m 0,0 h 71.95639 c 39.75591,0 71.95639,34.079345 71.95639,76.11387 0,42.05451 -32.20048,76.11387 -71.95639,76.11387 H 0 Z" style="fill:#0070c0;fill-opacity:1;fill-rule:evenodd;stroke:none"/>
          <path id="path7" d="M 76.913385,27.183525 115.29013,75.154451 76.913385,123.12538 Z" style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none"/>
          <path id="path9" d="M 28.622652,27.183525 66.999394,50.049666 V 100.27923 L 28.622652,123.12538 Z" style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none"/>
          <path id="path11" d="m 67.079345,75.234403 h 9.93398" style="fill:none;stroke:#ffffff;stroke-width:3.99757719px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:8;stroke-dasharray:none;stroke-opacity:1"/>
        </svg>`;

        dace_logo = "data:image/svg+xml;base64," + btoa(dace_logo);

        startpage_resources.appendChild(this.createStartpageListElement("Visit DaCe on GitHub", null, null, "external_lib/GitHub-Mark.png", x => {
            window.open("https://github.com/spcl/dace", "_blank");
        }));
        startpage_resources.appendChild(this.createStartpageListElement("Visit project page", null, null, dace_logo, x => {
            window.open("https://spcl.inf.ethz.ch/Research/DAPP/", "_blank");
        }));


        startpage_container.appendChild(startpage_recent);
        startpage_container.appendChild(startpage_resources);

        parent.appendChild(startpage_container);
    }

    createStartpageListElement(name, time, info, image = undefined, onclick = x => x) {

        const diode_image = `<svg width="50" height="50" version="1.1" viewBox="0 0 13.229 13.229" xmlns="http://www.w3.org/2000/svg"><g transform="translate(0 -283.77)" fill="none" stroke="#000" stroke-linecap="round" stroke-width=".68792"><path d="m3.3994 287.29v6.9099l6.5603-3.7876-6.5644-3.7899z" stroke-linejoin="round"/><g><path d="m3.3191 290.39h-2.6127"/><path d="m12.624 290.41h-2.6647v-3.3585"/><path d="m9.9597 290.41v2.9962"/></g></g></svg>`;
        if (image == undefined) {
            image = "data:image/svg+xml;base64," + btoa(diode_image);
        }
        const elem = document.createElement("div");
        elem.classList = "startpage_list_element";

        const cols = document.createElement('div');
        {
            cols.classList = "flex_row";
            // Col 1: Image
            const img = document.createElement('img');
            img.src = image;
            img.width = "50";
            img.height = "50";
            cols.appendChild(img);

            // Col 2: Row
            const col2 = document.createElement('div');
            {
                col2.classList = "flex_column";
                // This row includes project name and details
                const proj_name = document.createElement('span');
                proj_name.innerText = name;
                const proj_detail = document.createElement('span');
                proj_detail.innerText = info;

                col2.appendChild(proj_name);
                if (info != null)
                    col2.appendChild(proj_detail);
                else {
                    // We have space to use - use a bigger font
                    proj_name.style.fontSize = "1.2rem";


                    col2.style.justifyContent = "center";
                }
            }
            cols.appendChild(col2);

            const col3 = document.createElement('div');
            {
                col3.classList = "flex_column";
                // This row includes project date
                const proj_date = document.createElement('span');
                proj_date.innerText = time;
                const proj_unused = document.createElement('span');

                if (proj_date != null) {
                    col3.appendChild(proj_date);
                    col3.appendChild(proj_unused);
                }
            }
            cols.appendChild(col3);
        }
        elem.appendChild(cols);

        elem.addEventListener('click', onclick);

        return elem;
    }
}
