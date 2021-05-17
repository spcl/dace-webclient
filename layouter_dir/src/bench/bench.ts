import DagreLayouter from "../layouter/dagreLayouter";
import LayoutAnalysis from "./layoutAnalysis";
import Layouter from "../layouter/layouter";
import PerformanceAnalysis from "./performanceAnalysis";
import RenderGraph from "../renderGraph/renderGraph";
import Serializer from "../util/serializer";

export default class Bench {
    public static GRAPHS_SMALL = ["gemm_opt", "jacobi", "placement", "symm", "syrk", "trisolv", "trmm", "wrong"];
    public static GRAPHS_MEDIUM = ["bert2", "encbwd", "unreadable", "VA-gpu"]
    public static GRAPHS_LARGE = ["bert", "lulesh-with-maps", "rgf_dense"];
    public static GRAPHS_ALL = ["bert", "bert2", "encbwd", "gemm_opt", "jacobi", "lulesh-with-maps", "placement", "rgf_dense", "symm", "syrk", "trisolv", "trmm", "unreadable", "VA-gpu", "wrong"];
    public static GRAPHS_POLYBENCH = ["npbench/polybench/adi", "npbench/polybench/atax", "npbench/polybench/bicg", "npbench/polybench/cholesky", "npbench/polybench/correlation", "npbench/polybench/covariance", "npbench/polybench/deriche", "npbench/polybench/doitgen", "npbench/polybench/durbin", "npbench/polybench/fdtd_2d", "npbench/polybench/floyd_warshall", "npbench/polybench/gemm", "npbench/polybench/gemver", "npbench/polybench/gesummv", "npbench/polybench/gramschmidt", "npbench/polybench/heat_3d", "npbench/polybench/jacobi_1d", "npbench/polybench/jacobi_2d", "npbench/polybench/k2mm", "npbench/polybench/k3mm", "npbench/polybench/lu", "npbench/polybench/ludcmp", "npbench/polybench/mvt", "npbench/polybench/nussinov", "npbench/polybench/seidel_2d", "npbench/polybench/symm", "npbench/polybench/syr2k", "npbench/polybench/syrk", "npbench/polybench/trisolv", "npbench/polybench/trmm"];
    public static GRAPHS_NPBENCH = ["npbench/pythran/arc_distance", "npbench/weather_stencils/vadv", "npbench/azimint_hist", "npbench/azimint_naive", "npbench/cavity_flow", "npbench/channel_flow", "npbench/compute", "npbench/go_fast", "npbench/mandelbrot1", "npbench/nbody", "npbench/scattering_self_energies", "npbench/stockham_fft"];

    public static LAYOUTERS = [new DagreLayouter()];

    public static validate(loadFunction: (name: string) => Promise<RenderGraph>, layouter: Layouter, graphs: Array<string> = Bench.GRAPHS_ALL) {
        const promises = graphs.map(name => {
            return loadFunction(name).then((renderGraph: RenderGraph) => {
                const layoutGraph = layouter.layout(renderGraph);
                const layoutAnalysis = new LayoutAnalysis(layoutGraph, layouter.getOptionsForAnalysis());
                if (!layoutAnalysis.validate()) {
                    throw new Error('Layouter returned invalid layout for graph "' + name + '".');
                }
            });
        })
        return Promise.all(promises);
    }

    public static cost(loadFunction: (name: string) => Promise<RenderGraph>, layouter: Layouter, graphs: Array<string> = Bench.GRAPHS_ALL) {
        const promises = graphs.map(name => {
            return loadFunction(name).then((renderGraph: RenderGraph) => {
                const layoutGraph = layouter.layout(renderGraph);
                const layoutAnalysis = new LayoutAnalysis(layoutGraph, layouter.getOptionsForAnalysis());
                return layoutAnalysis.cost();
            });
        });
        return Serializer.serializePromises(promises);
    }

    public static crossings(loadFunction: (name: string) => Promise<RenderGraph>, layouter: Layouter, graphs: Array<string> = Bench.GRAPHS_ALL) {
        const promises = graphs.map(name => {
            return loadFunction(name).then((renderGraph: RenderGraph) => {
                const layoutGraph = layouter.layout(renderGraph);
                const layoutAnalysis = new LayoutAnalysis(layoutGraph, layouter.getOptionsForAnalysis());
                return layoutAnalysis.segmentCrossings();
            });
        });
        return Serializer.serializePromises(promises);
    }

    public static performance(loadFunction: (name: string) => Promise<RenderGraph>, layouter: Layouter, graphs: Array<string> = Bench.GRAPHS_ALL) {
        const promises = graphs.map(name => {
            const performanceAnalysis = new PerformanceAnalysis(layouter);
            return performanceAnalysis.measure(name);
        });
        return Serializer.serializePromises(promises);
    }
}
