// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import * as d3 from 'd3';

import { BarController, BarElement, CategoryScale, Chart, Colors, Legend, LinearScale, Tooltip } from 'chart.js';
import '../../scss/access_statistics.scss';
import { sdfg_range_elem_to_string } from '../utils/sdfg/display';
import { read_or_decompress } from '../utils/sdfg/json_serializer';

interface Subset {
    type: string;
    ranges: {
        start: string;
        end: string;
        step: string;
        tile: string;
    }[];
}

interface Access {
    anode?: string;
    block?: string;
    edge?: string;
    mode: 'write' | 'read';
    subset: Subset;
}

interface DataAccessCategory {
    n_accesses: number;
    name: string;
    accesses: Access[];
}

interface DataRecord {
    total_accesses: number;
    categories: DataAccessCategory[];
}

type SDFGAccessStats = Record<string, DataRecord>;
type AccessStats = Record<number, Record<string, DataRecord>>;

function subsetToString(subset: Subset) {
    const ranges = subset.ranges;
    let preview = '[';
    for (const range of ranges)
        preview += sdfg_range_elem_to_string(range, {}) + ', ';
    return preview.slice(0, -2) + ']';
}

function createD3CompatData(stats: SDFGAccessStats): any {
    const allContainers = [];
    for (const dname of Object.keys(stats)) {
        const children = [];
        for (const category of stats[dname].categories) {
            const accesses = [];
            for (const access of category.accesses) {
                accesses.push({
                    name: subsetToString(access.subset),
                    value: 1,
                });
            }
            children.push({
                name: category.name,
                children: accesses,
            });
        }
        const entry = {
            name: dname,
            children: children,
        };
        allContainers.push(entry);
    }
    const data = {
        name: 'sdfg',
        children: allContainers,
    }
    return data;
}

function createD3Hierarchy(data: any): d3.HierarchyNode<any> {
    return d3.hierarchy(data);
}

function drawSDFGChart(stats: SDFGAccessStats): void {
    const data = createD3CompatData(stats);

    const width = 1000;
    const height = 100000;
    const format = d3.format(',d');

    const color = d3.scaleOrdinal(d3.quantize(d3.interpolateRainbow, data.children.length))
    const partition = d3.partition().size([height, width]).padding(1);

    // ROOT
    const hierarchy = d3.hierarchy(data as any);
    const root = partition(hierarchy.sum(d => d.value).sort((a, b) => {
        return b.height - a.height || b.value! - a.value!;
    }));

    const svg = d3.create('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', [0, 0, width, height])
        .attr('style', 'max-width: 100%; height: auto; font: 10px sans-serif;');

    const cell = svg.selectAll().data(root.descendants()).join('g').attr('transform', d => `translate(${d.y0},${d.x0})`)

    cell.append('title').text(d => `${d.ancestors().map(d => (d.data as any).name).reverse().join('/')}\n${d.value === undefined ? '' : format(d.value)}`);

    cell.append('rect')
        .attr('width', d => d.y1 - d.y0)
        .attr('height', d => d.x1 - d.x0)
        .attr('fill-opacity', 0.6)
        .attr('fill', d => {
            if (!d.depth) return '#ccc';
            while (d.depth > 1) d = d.parent as any;
            return color((d.data as any).name)
        });

        const text = cell.filter(d => (d.x1 - d.x0) > 16).append('text')
            .attr('x', 4)
            .attr('y', 13);

        text.append('tspan').text(d => (d.data as any).name);
        text.append('tspan').attr('fill-opacity', 0.7).text(d => d.value === undefined ? '' : ` ${format(d.value)}`);

    const graphElement = svg.node();
    if (graphElement)
        $('#statistics-contents').append(graphElement);
}

function drawSDFGSunburst(stats: SDFGAccessStats): void {
    const data = createD3CompatData(stats);

    // Specify the chart’s colors and approximate radius (it will be adjusted at the end).
    const color = d3.scaleOrdinal(d3.quantize(d3.interpolateRainbow, data.children.length + 1));
    const radius = 928 / 2;

    // Prepare the layout.
    const hierarchy = d3.hierarchy(data).sum(d => d.value).sort((a, b) => b.value! - a.value!);
    const partition = d3.partition().size([2 * Math.PI, radius]);

    const arc = d3.arc()
        .startAngle((d: any) => d.x0)
        .endAngle((d: any) => d.x1)
        .padAngle((d: any) => Math.min((d.x1 - d.x0) / 2, 0.005))
        .padRadius(radius / 2)
        .innerRadius((d: any) => d.y0)
        .outerRadius((d: any) => d.y1 - 1);

    const root = partition(hierarchy);

    // Create the SVG container.
    const svg = d3.create('svg');

    // Add an arc for each element, with a title for tooltips.
    const format = d3.format(',d');
    svg.append('g')
        .attr('fill-opacity', 0.6)
        .selectAll('path')
        .data(root.descendants().filter(d => d.depth))
        .join('path')
        .attr('fill', (d: any) => {
            while (d.depth > 1)
                d = d.parent;
            return color(d.data.name);
        })
        .attr('d', arc as any)
        .append('title')
        .text(d => `${d.ancestors().map((d: any) => d.data.name).reverse().join("/")}\n${format(d.value!)}`);

    // Add a label for each element.
    svg.append('g')
        .attr('pointer-events', 'none')
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .attr('font-family', 'sans-serif')
        .selectAll('text')
        .data(root.descendants().filter(d => d.depth && (d.y0 + d.y1) / 2 * (d.x1 - d.x0) > 10))
        .join('text')
        .attr('transform', function(d) {
            const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
            const y = (d.y0 + d.y1) / 2;
            return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
        })
        .attr('dy', '0.35em')
        .text((d: any) => d.data.name);

    // The autoBox function adjusts the SVG’s viewBox to the dimensions of its contents.
    //graphElement = svg.attr("viewBox", autoBox).node();
    const graphElement = svg.node();
    const autoBox = () => {
        document.body.appendChild(graphElement!);
        const {x, y, width, height} = graphElement!.getBBox();
        document.body.removeChild(graphElement!);
        return [x, y, width, height];
    }
    svg.attr('viewBox', autoBox);
    if (graphElement)
        $('#statistics-contents').append(graphElement);
}

function drawChart(allStats: AccessStats): void {
    const stats = allStats[0];
    drawSDFGChart(stats);
}

interface _AccessRecord {
    anode?: string;
    block?: string;
    edge?: string;
    mode: 'write' | 'read';
    at: Subset;
}

interface _AccessTypeSubCategory {
    name: string;
    n_accesses: number;
    accesses: _AccessRecord[];
}

interface _DataContainerAccessStats {
    container: string;
    n_total_accesses: number;
    constant_accesses: _AccessTypeSubCategory[];
    indirect_accesses: _AccessTypeSubCategory[];
    linear_accesses: _AccessTypeSubCategory[];
    strided_accesses: _AccessTypeSubCategory[];
}

interface _SDFGAccessStats {
    name: string;
    id: number;
    n_total_accesses: number;
    accesses: _DataContainerAccessStats[];
}

interface _AccessStatistics {
    all_sdfg_stats: _SDFGAccessStats[];
}

type _AccessType = 'linear_accesses' | 'strided_accesses' |
    'indirect_accesses' | 'constant_accesses';

const SDFG_SORTING_CRITERIUM: 'all_accesses' | _AccessType = 'all_accesses';
const SDFG_SORTING_STYLE: 'ascending' | 'descending' = 'ascending';

function buildDataContainerHist(
    data: _DataContainerAccessStats, root: JQuery<HTMLElement>,
    collapse: JQuery<HTMLElement>, expanded: boolean
): void {
    const datasets: any[] = [];
    for (const access of data.constant_accesses) {
        datasets.push({
            label: access.name,
            data: [access.n_accesses, 0, 0, 0],
        });
    }
    for (const access of data.indirect_accesses) {
        datasets.push({
            label: access.name,
            data: [0, access.n_accesses, 0, 0],
        });
    }
    for (const access of data.linear_accesses) {
        datasets.push({
            label: access.name,
            data: [0, 0, access.n_accesses, 0],
        });
    }
    for (const access of data.strided_accesses) {
        datasets.push({
            label: access.name,
            data: [0, 0, 0, access.n_accesses],
        });
    }

    const canvas = $('<canvas>').appendTo(root) as JQuery<HTMLCanvasElement>;
    let chart: Chart | undefined = undefined;

    function createChart() {
        chart = new Chart(
            canvas,
            {
                type: 'bar',
                data: {
                    labels: ['Constant', 'Indirect', 'Linear', 'Strided'],
                    datasets: datasets,
                },
                options: {
                    animation: false,
                    scales: {
                        y: {
                            stacked: true,
                        },
                        x: {
                            stacked: true,
                        },
                    },
                },
            }
        );
    }

    collapse[0].addEventListener('show.bs.collapse', () => {
        createChart();
    });

    collapse[0].addEventListener('hidden.bs.collapse', () => {
        if (chart)
            chart.destroy();
    });

    if (expanded)
        createChart();
}

function constructAccordion<T>(
    container: JQuery<HTMLElement>, data: Iterable<T>,
    idFun: (record: T) => string, headerTextFun: (record: T) => string,
    id: string, expandFirst: boolean = true,
    recordFun?: (
        record: T, root: JQuery<HTMLElement>, collapse: JQuery<HTMLElement>,
        expanded: boolean
    ) => any
): JQuery<HTMLElement> {
    const accordion = $('<div>', {
        class: 'accordion',
        id: id,
    }).appendTo(container);

    let first = expandFirst;
    for (const record of data) {
        const recordId = idFun(record);
        const accordionItem = $('<div>', {
            class: 'accordion-item',
        }).appendTo(accordion);
        const header = $('<h2>', {
            class: 'accordion-header',
        }).appendTo(accordionItem);
        $('<button>', {
            class: 'accordion-button' + (first ? '' : ' collapsed'),
            type: 'button',
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#' + recordId,
            'aria-expanded': (first ? 'true' : 'false'),
            'aria-controls': recordId,
            text: headerTextFun(record),
        }).appendTo(header);
        const collapse = $('<div>', {
            id: recordId,
            class: 'accordion-collapse collapse' + (first ? ' show' : ''),
            'data-bs-parent': '#' + id,
        }).appendTo(accordionItem);
        const accordionBody = $('<div>', {
            class: 'accordion-body',
        }).appendTo(collapse);
        const recordContentsContainer = $('<div>', {
            class: 'container-fluid',
        }).appendTo(accordionBody);
        if (recordFun !== undefined)
            recordFun(record, recordContentsContainer, collapse, first);
        first = false;
    }

    return accordion;
}

function buildSDFGTreeView(
    data: _SDFGAccessStats, root: JQuery<HTMLElement>,
    _collapse: JQuery<HTMLElement>, _expanded: boolean
): void {
    const countAllContainerAccessesOfType = (
        record: _DataContainerAccessStats, type: _AccessType
    ): number => {
        let nAccesses = 0;
        for (const subCat of record[type])
            nAccesses += subCat.n_accesses;
        return nAccesses;
    };

    switch (SDFG_SORTING_CRITERIUM) {
        case 'linear_accesses':
        case 'strided_accesses':
        case 'indirect_accesses':
        case 'constant_accesses':
            data.accesses.sort((a, b) => {
                let nA = countAllContainerAccessesOfType(
                    a, SDFG_SORTING_CRITERIUM
                );
                let nB = countAllContainerAccessesOfType(
                    b, SDFG_SORTING_CRITERIUM
                );
                if (SDFG_SORTING_STYLE == 'ascending')
                    return nB - nA;
                else
                    return nA - nB;
            });
            break;
        case 'all_accesses':
        default:
            data.accesses.sort((a, b) => {
                if (SDFG_SORTING_STYLE == 'ascending')
                    return b.n_total_accesses - a.n_total_accesses;
                else
                    return a.n_total_accesses - b.n_total_accesses;
            });
            break;
    }

    constructAccordion(
        root, data.accesses, (record) => {
            return (
                'data-container-stats-entry-' + data.id.toString() + '-' +
                record.container
            );
        }, (record) => {
            return (
                record.container + ' (' + record.n_total_accesses.toString() +
                ')'
            );
        }, 'sdfg-stats-accordion-sdfg-entry-' + data.id.toString(), true,
        buildDataContainerHist
    );
}

function buildTreeView(data: _AccessStatistics): void {
    const container = $('#statistics-contents');
    container.html();

    const countAllSDFGAccessesOfType = (
        record: _SDFGAccessStats, type: _AccessType
    ): number => {
        let nAccesses = 0;
        for (const dataRecord of record.accesses) {
            let recordAccesses = 0;
            for (const subCat of dataRecord[type])
                recordAccesses += subCat.n_accesses;
            nAccesses += recordAccesses;
        }
        return nAccesses;
    };

    switch (SDFG_SORTING_CRITERIUM) {
        case 'linear_accesses':
        case 'strided_accesses':
        case 'indirect_accesses':
        case 'constant_accesses':
            data.all_sdfg_stats.sort((a, b) => {
                let nA = countAllSDFGAccessesOfType(a, SDFG_SORTING_CRITERIUM);
                let nB = countAllSDFGAccessesOfType(b, SDFG_SORTING_CRITERIUM);
                if (SDFG_SORTING_STYLE == 'ascending')
                    return nB - nA;
                else
                    return nA - nB;
            });
            break;
        case 'all_accesses':
        default:
            data.all_sdfg_stats.sort((a, b) => {
                if (SDFG_SORTING_STYLE == 'ascending')
                    return b.n_total_accesses - a.n_total_accesses;
                else
                    return a.n_total_accesses - b.n_total_accesses;
            });
            break;
    }

    constructAccordion(
        container, data.all_sdfg_stats,
        (record) => 'sdfg-stats-entry-id-' + record.id.toString(),
        (record) => (
            'SDFG ' + record.id.toString() + ': ' + record.name +
            ' (' + record.n_total_accesses.toString() + ')'
        ), 'sdfg-stats-accordion', true, buildSDFGTreeView
    );
}

function loadAccessStats(changeEvent: any): void {
    if (changeEvent.target.files.length < 1)
        return;
    const accessStatsFile = changeEvent.target.files[0];
    if (!accessStatsFile)
        return;

    const fileReader = new FileReader();
    fileReader.onload = (e) => {
        const result = e.target?.result;

        if (result) {
            const packedResult = read_or_decompress(result);
            const parsedObj = JSON.parse(packedResult[0]);
            //manuallyDrawChart(parsedObj);
            //drawChart(parsedObj);
            buildTreeView(parsedObj);
        }
    };
    fileReader.readAsArrayBuffer(accessStatsFile);
}

$(() => {
    Chart.register(
        BarController, BarElement, CategoryScale, Tooltip, Legend,
        LinearScale, Colors
    );

    $(document).on(
        'change.sdfv', '#sdfg-access-stats-file-input', loadAccessStats
    );
});
