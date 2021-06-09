// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

export class TableCategory {

    constructor(table, parent_row) {
        this._table = table;
        this._title_row = parent_row;
        this._cat_rows = [];

        this._title_row.classList.add("diode_property_header");

        this._title_row.addEventListener('click', ev => {
            for (const x of this._cat_rows) {
                if (x.style.display == "none") {
                    x.style.display = null;
                    this._title_row.classList.remove("collapsed");
                }
                else {
                    x.style.display = "none";
                    this._title_row.classList.add("collapsed");
                }
            }
        });
    }

    addContentRow(row) {
        this._cat_rows.push(row);
    }

}


export class Table {
    constructor() {

        this.init();
    }

    init() {
        this._table = document.createElement('table');
        this._thead = document.createElement('thead');
        this._tbody = document.createElement('tbody');

        this._table.appendChild(this._thead);
        this._table.appendChild(this._tbody);

        this._is_collapsed = false;
    }

    createIn(elem) {
        elem.appendChild(this._table);
    }

    setHeaders(...columns) {
        this._columns = columns;

        this._thead.innerHTML = "";

        const tr = document.createElement("tr");
        for (const x of this._columns) {
            const th = document.createElement('th');
            if (typeof (x) === 'string') {
                th.innerText = x;
            }
            else {
                th.appendChild(x);
            }
            tr.appendChild(th);
        }
        this._thead.appendChild(tr);
        return tr;
    }

    addRow(...columns) {

        const tmp = columns;

        const tr = document.createElement("tr");
        for (const x of tmp) {
            const td = document.createElement('td');
            if (typeof (x) === 'string') {
                td.innerText = x;
            }
            else {
                td.appendChild(x);
            }
            tr.appendChild(td);
        }

        this._tbody.appendChild(tr);
        return tr;
    }

    collapseVertically() {
        this._table.style.display = "none";
        this._is_collapsed = true;
    }

    expandVertically() {
        this._table.style.display = null;
        this._is_collapsed = false;
    }

    toggleVertically() {
        if (this._is_collapsed) {
            this.expandVertically();
        }
        else {
            this.collapseVertically();
        }
    }

    setCSSClass(classname) {
        this._table.classList = classname;
    }

}
